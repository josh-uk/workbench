import { describe, expect, it } from "vitest";

import {
  assertionDefinitionSchema,
  assertionTypes,
  defaultAssertion,
  type AssertionDefinition,
  unsafeRegexReason,
} from "./domain";
import { evaluateAssertions, type AssertionResponse } from "./evaluator";

const response: AssertionResponse = {
  statusCode: 201,
  durationMs: 42,
  headers: [
    { name: "Content-Type", value: "application/json" },
    { name: "X-Request-Id", value: "abc-123" },
  ],
  rawBody: JSON.stringify({
    id: "abc-123",
    state: "ready",
    nested: { count: 2 },
  }),
  bodyPreview: '{"id":"abc-123","state":"ready"}',
  contentType: "application/json",
};

function owned(definitions: AssertionDefinition[]) {
  return definitions.map((definition) => ({
    definition,
    owner: "request" as const,
  }));
}

describe("response assertion evaluation", () => {
  it("evaluates every supported no-code assertion", () => {
    const definitions: AssertionDefinition[] = [
      {
        name: "Created",
        enabled: true,
        type: "status_equals",
        configuration: { expected: 201 },
      },
      {
        name: "Success range",
        enabled: true,
        type: "status_range",
        configuration: { minimum: 200, maximum: 299 },
      },
      {
        name: "Fast",
        enabled: true,
        type: "duration_below",
        configuration: { maximumMs: 100 },
      },
      {
        name: "Has request id",
        enabled: true,
        type: "header_exists",
        configuration: { name: "x-request-id" },
      },
      {
        name: "JSON content",
        enabled: true,
        type: "header_equals",
        configuration: {
          name: "content-type",
          expected: "APPLICATION/JSON",
          caseSensitive: false,
        },
      },
      {
        name: "Has nested value",
        enabled: true,
        type: "jsonpath_exists",
        configuration: { path: "$.nested.count" },
      },
      {
        name: "State ready",
        enabled: true,
        type: "jsonpath_equals",
        configuration: { path: "$.state", expected: "ready", mode: "text" },
      },
      {
        name: "Identifier shape",
        enabled: true,
        type: "jsonpath_regex",
        configuration: { path: "$.id", pattern: "^abc-[0-9]+$", flags: "" },
      },
      {
        name: "Contains state",
        enabled: true,
        type: "body_contains",
        configuration: { text: '"state":"ready"', caseSensitive: true },
      },
      {
        name: "Response contract",
        enabled: true,
        type: "body_schema",
        configuration: {
          schema: JSON.stringify({
            type: "object",
            required: ["id", "state"],
            properties: {
              id: { type: "string" },
              state: { const: "ready" },
            },
          }),
        },
      },
    ];

    const results = evaluateAssertions(response, owned(definitions));

    expect(results).toHaveLength(10);
    expect(results.every(({ passed }) => passed)).toBe(true);
    expect(results.every(({ owner }) => owner === "request")).toBe(true);
  });

  it("returns readable failures without including actual response values", () => {
    const results = evaluateAssertions(
      response,
      owned([
        {
          name: "Wrong status",
          enabled: true,
          type: "status_equals",
          configuration: { expected: 204 },
        },
        {
          name: "Missing path",
          enabled: true,
          type: "jsonpath_equals",
          configuration: {
            path: "$.secret",
            expected: "not-recorded",
            mode: "text",
          },
        },
        {
          name: "Invalid contract",
          enabled: true,
          type: "body_schema",
          configuration: {
            schema: JSON.stringify({
              type: "object",
              required: ["missing"],
            }),
          },
        },
      ]),
    );

    expect(results.map(({ passed }) => passed)).toEqual([false, false, false]);
    expect(JSON.stringify(results)).not.toContain("abc-123");
    expect(results[1]?.message).toContain("did not match a value");
    expect(results[2]?.message).toContain("required property");
  });

  it("covers negative outcomes and canonical JSON comparison", () => {
    const results = evaluateAssertions(
      response,
      owned([
        {
          name: "Outside range",
          enabled: true,
          type: "status_range",
          configuration: { minimum: 202, maximum: 299 },
        },
        {
          name: "Too slow",
          enabled: true,
          type: "duration_below",
          configuration: { maximumMs: 20 },
        },
        {
          name: "Missing header",
          enabled: true,
          type: "header_exists",
          configuration: { name: "X-Missing" },
        },
        {
          name: "Wrong header",
          enabled: true,
          type: "header_equals",
          configuration: {
            name: "X-Request-Id",
            expected: "wrong",
            caseSensitive: true,
          },
        },
        {
          name: "Missing JSONPath",
          enabled: true,
          type: "jsonpath_exists",
          configuration: { path: "$.missing" },
        },
        {
          name: "Canonical JSON",
          enabled: true,
          type: "jsonpath_equals",
          configuration: {
            path: "$.nested",
            expected: '{"count":2}',
            mode: "json",
          },
        },
        {
          name: "Regex mismatch",
          enabled: true,
          type: "jsonpath_regex",
          configuration: { path: "$.id", pattern: "^z", flags: "" },
        },
        {
          name: "Missing text",
          enabled: true,
          type: "body_contains",
          configuration: { text: "ABSENT", caseSensitive: false },
        },
      ]),
    );

    expect(results.map(({ passed }) => passed)).toEqual([
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
    ]);
  });

  it("creates valid defaults for every assertion type", () => {
    for (const type of assertionTypes) {
      expect(assertionDefinitionSchema.parse(defaultAssertion(type)).type).toBe(
        type,
      );
    }
  });

  it("skips disabled assertions and rejects risky regular expressions", () => {
    const results = evaluateAssertions(
      response,
      owned([
        {
          name: "Disabled failure",
          enabled: false,
          type: "status_equals",
          configuration: { expected: 500 },
        },
      ]),
    );

    expect(results).toEqual([]);
    expect(unsafeRegexReason("(a+)+$")).toContain("Nested");
    expect(unsafeRegexReason("(a)\\1")).toContain("backreferences");
    expect(unsafeRegexReason("a+a+")).toContain("Multiple unbounded");
    expect(unsafeRegexReason("(a|aa)+")).toContain("alternatives");
    expect(unsafeRegexReason("(?=a)")).toContain("lookarounds");
    expect(unsafeRegexReason("[")).toContain("invalid");
    expect(unsafeRegexReason("a".repeat(257))).toContain("256");
    expect(unsafeRegexReason("^abc-[0-9]+$")).toBeNull();
  });

  it("does not include invalid response content in assertion errors", () => {
    const secret = "azure-kv-supersecret";
    const results = evaluateAssertions(
      { ...response, rawBody: secret, bodyPreview: "••••••••" },
      owned([
        {
          name: "Secret must be JSON",
          enabled: true,
          type: "jsonpath_exists",
          configuration: { path: "$.value" },
        },
      ]),
    );

    expect(results[0]).toMatchObject({ passed: false });
    expect(results[0]?.message).not.toContain(secret);
  });
});
