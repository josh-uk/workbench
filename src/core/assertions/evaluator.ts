import Ajv from "ajv";

import {
  evaluateJsonPath,
  JsonPathError,
  outputValueToString,
} from "@/core/request-outputs/json-path";

import {
  assertionDefinitionSchema,
  type AssertionDefinition,
  type AssertionResult,
} from "./domain";

export interface AssertionResponse {
  statusCode: number;
  durationMs: number;
  headers: Array<{ name: string; value: string }>;
  rawBody: string | null;
  bodyPreview: string;
  contentType: string | null;
}

interface OwnedAssertion {
  definition: AssertionDefinition;
  owner: AssertionResult["owner"];
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonical(child)]),
  );
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function jsonBody(response: AssertionResponse) {
  if (!response.rawBody) throw new Error("Response body is not JSON text.");
  return JSON.parse(response.rawBody) as unknown;
}

function header(response: AssertionResponse, name: string) {
  return response.headers.find(
    (item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
  );
}

function result(
  assertion: OwnedAssertion,
  passed: boolean,
  message: string,
): AssertionResult {
  return {
    assertionId: assertion.definition.id ?? null,
    name: assertion.definition.name,
    type: assertion.definition.type,
    owner: assertion.owner,
    passed,
    message,
  };
}

function evaluateOne(
  assertion: OwnedAssertion,
  response: AssertionResponse,
): AssertionResult {
  const definition = assertionDefinitionSchema.parse(assertion.definition);
  switch (definition.type) {
    case "status_equals": {
      const passed = response.statusCode === definition.configuration.expected;
      return result(
        assertion,
        passed,
        passed
          ? `Status was ${response.statusCode}.`
          : `Expected status ${definition.configuration.expected}; received ${response.statusCode}.`,
      );
    }
    case "status_range": {
      const passed =
        response.statusCode >= definition.configuration.minimum &&
        response.statusCode <= definition.configuration.maximum;
      return result(
        assertion,
        passed,
        passed
          ? `Status ${response.statusCode} was in range.`
          : `Status ${response.statusCode} was outside ${definition.configuration.minimum}-${definition.configuration.maximum}.`,
      );
    }
    case "duration_below": {
      const passed = response.durationMs < definition.configuration.maximumMs;
      return result(
        assertion,
        passed,
        passed
          ? `Duration ${response.durationMs} ms was below the threshold.`
          : `Duration ${response.durationMs} ms was not below ${definition.configuration.maximumMs} ms.`,
      );
    }
    case "header_exists": {
      const passed = Boolean(header(response, definition.configuration.name));
      return result(
        assertion,
        passed,
        passed
          ? `Header ${definition.configuration.name} was present.`
          : `Header ${definition.configuration.name} was missing.`,
      );
    }
    case "header_equals": {
      const found = header(response, definition.configuration.name);
      const actual = found?.value ?? "";
      const passed =
        Boolean(found) &&
        (definition.configuration.caseSensitive
          ? actual === definition.configuration.expected
          : actual.toLocaleLowerCase() ===
            definition.configuration.expected.toLocaleLowerCase());
      return result(
        assertion,
        passed,
        passed
          ? `Header ${definition.configuration.name} matched.`
          : `Header ${definition.configuration.name} was missing or did not match.`,
      );
    }
    case "jsonpath_exists": {
      const value = evaluateJsonPath(
        jsonBody(response),
        definition.configuration.path,
      );
      const passed = value !== undefined;
      return result(
        assertion,
        passed,
        passed
          ? `JSONPath ${definition.configuration.path} matched a value.`
          : `JSONPath ${definition.configuration.path} did not match a value.`,
      );
    }
    case "jsonpath_equals": {
      const value = evaluateJsonPath(
        jsonBody(response),
        definition.configuration.path,
      );
      const passed =
        definition.configuration.mode === "json"
          ? sameJson(
              value,
              JSON.parse(definition.configuration.expected) as unknown,
            )
          : outputValueToString(value) === definition.configuration.expected;
      return result(
        assertion,
        passed,
        passed
          ? `JSONPath ${definition.configuration.path} matched.`
          : `JSONPath ${definition.configuration.path} did not match the expected value.`,
      );
    }
    case "jsonpath_regex": {
      const value = outputValueToString(
        evaluateJsonPath(jsonBody(response), definition.configuration.path),
      );
      if (value.length > 65_536) {
        throw new Error("The JSONPath value is too large for regex matching.");
      }
      const passed = new RegExp(
        definition.configuration.pattern,
        definition.configuration.flags,
      ).test(value);
      return result(
        assertion,
        passed,
        passed
          ? `JSONPath ${definition.configuration.path} matched the expression.`
          : `JSONPath ${definition.configuration.path} did not match the expression.`,
      );
    }
    case "body_contains": {
      const body = response.rawBody ?? response.bodyPreview;
      const passed = definition.configuration.caseSensitive
        ? body.includes(definition.configuration.text)
        : body
            .toLocaleLowerCase()
            .includes(definition.configuration.text.toLocaleLowerCase());
      return result(
        assertion,
        passed,
        passed
          ? "Response body contained the expected text."
          : "Response body did not contain the expected text.",
      );
    }
    case "body_schema": {
      const schema = JSON.parse(definition.configuration.schema) as object;
      const ajv = new Ajv({
        allErrors: true,
        strict: false,
        validateFormats: false,
      });
      const validate = ajv.compile(schema);
      const passed = validate(jsonBody(response));
      const details = validate.errors
        ?.slice(0, 3)
        .map(
          (error) =>
            `${error.instancePath || "$"} ${error.message ?? "is invalid"}`,
        )
        .join("; ");
      return result(
        assertion,
        passed,
        passed
          ? "Response body matched the JSON Schema."
          : `Response body did not match the JSON Schema${details ? `: ${details}` : "."}`,
      );
    }
  }
}

export function evaluateAssertions(
  response: AssertionResponse,
  assertions: OwnedAssertion[],
) {
  return assertions
    .filter(({ definition }) => definition.enabled)
    .map((assertion) => {
      try {
        return evaluateOne(assertion, response);
      } catch (error) {
        return result(
          assertion,
          false,
          error instanceof JsonPathError
            ? error.message
            : "Assertion evaluation failed because the response or assertion configuration was invalid.",
        );
      }
    });
}
