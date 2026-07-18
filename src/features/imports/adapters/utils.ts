import { createHash } from "node:crypto";

import {
  CollectionImportError,
  MAX_COLLECTION_IMPORT_BYTES,
  MAX_COLLECTION_REQUESTS,
  type PortableImportPlan,
  type PortableImportRequest,
  type PortableImportVariable,
} from "../domain";
import {
  httpMethods,
  parseRequestSettings,
  requestBodySchema,
  requestFieldSchema,
} from "@/features/requests/domain";

export type JsonObject = Record<string, unknown>;

const prohibitedKeys = new Set(["__proto__", "constructor", "prototype"]);

export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function objectValue(value: unknown): JsonObject {
  return isObject(value) ? value : {};
}

export function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function optionalText(value: unknown) {
  const text = stringValue(value)?.trim();
  return text ? text : null;
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sorted(value[key])]),
  );
}

export function hashImportValue(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(sorted(value)))
    .digest("hex");
}

export function parseBoundedJson(input: string) {
  if (Buffer.byteLength(input, "utf8") > MAX_COLLECTION_IMPORT_BYTES) {
    throw new CollectionImportError(
      "Import sources must be 2 MiB or smaller.",
      "IMPORT_SIZE_LIMIT",
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(input) as unknown;
  } catch (error) {
    throw new CollectionImportError(
      `The JSON import is invalid: ${error instanceof Error ? error.message : "parse failed"}`,
      "IMPORT_JSON_INVALID",
    );
  }
  let nodes = 0;
  const visit = (item: unknown, depth: number) => {
    nodes += 1;
    if (nodes > 100_000 || depth > 80) {
      throw new CollectionImportError(
        "The import source is too complex to process safely.",
        "IMPORT_COMPLEXITY_LIMIT",
      );
    }
    if (!item || typeof item !== "object") return;
    if (Array.isArray(item)) {
      item.forEach((child) => visit(child, depth + 1));
      return;
    }
    for (const [key, child] of Object.entries(item)) {
      if (prohibitedKeys.has(key)) {
        throw new CollectionImportError(
          "The import source contains a prohibited mapping key.",
          "IMPORT_PROTOTYPE_KEY",
        );
      }
      visit(child, depth + 1);
    }
  };
  visit(value, 0);
  return value;
}

export function normaliseMethod(
  value: unknown,
  warnings: string[],
): PortableImportRequest["method"] | null {
  const method = (stringValue(value) ?? "GET").toLocaleUpperCase();
  if (!httpMethods.includes(method as (typeof httpMethods)[number])) {
    warnings.push(`Unsupported HTTP method ${method} was skipped.`);
    return null;
  }
  return method as PortableImportRequest["method"];
}

export function normaliseName(value: unknown, fallback: string) {
  return (optionalText(value) ?? fallback).slice(0, 120);
}

export function portableVariable(
  name: unknown,
  value: unknown,
  secret = false,
  enabled = true,
): PortableImportVariable | null {
  const variableName = stringValue(name)?.trim();
  if (!variableName) return null;
  return {
    name: variableName.slice(0, 128),
    value: typeof value === "string" ? value : String(value ?? ""),
    secret,
    enabled,
  };
}

export function emptyBody(): PortableImportRequest["body"] {
  return { type: "none", content: null, contentType: null, metadata: {} };
}

export function bodyFromText(
  value: string,
  contentType: string | null,
): PortableImportRequest["body"] {
  const mime = contentType?.split(";", 1)[0]?.trim().toLocaleLowerCase() ?? "";
  if (mime.includes("json")) {
    let content = value;
    try {
      content = JSON.stringify(JSON.parse(value) as unknown, null, 2);
    } catch {
      // Preserve invalid JSON for the user to repair after import.
    }
    return {
      type: "json",
      content,
      contentType: contentType ?? "application/json",
      metadata: {},
    };
  }
  if (mime.includes("xml")) {
    return { type: "xml", content: value, contentType, metadata: {} };
  }
  if (mime === "application/x-www-form-urlencoded") {
    return {
      type: "form_urlencoded",
      content: value,
      contentType,
      metadata: {},
    };
  }
  return { type: "text", content: value, contentType, metadata: {} };
}

export function defaultSettings(
  input: {
    followRedirects?: boolean;
    tlsVerify?: boolean;
    timeoutMs?: number;
    cookies?: Array<{
      name: string;
      value: string;
      enabled: boolean;
      secret: boolean;
    }>;
  } = {},
) {
  return parseRequestSettings(input);
}

export function finalisePlan(
  plan: Omit<PortableImportPlan, "sourceHash">,
  source: unknown,
) {
  if (
    !plan.requests.length &&
    !plan.environments.length &&
    !plan.projectVariables.length
  ) {
    throw new CollectionImportError(
      "The import source does not contain any supported requests, environments, or variables.",
      "IMPORT_EMPTY",
    );
  }
  if (plan.requests.length > MAX_COLLECTION_REQUESTS) {
    throw new CollectionImportError(
      `Collection imports are limited to ${MAX_COLLECTION_REQUESTS} requests.`,
      "IMPORT_REQUEST_LIMIT",
    );
  }
  if (
    new Set(plan.requests.map(({ sourceKey }) => sourceKey)).size !==
    plan.requests.length
  ) {
    throw new CollectionImportError(
      "The import source contains duplicate request identifiers.",
      "IMPORT_DUPLICATE_REQUEST_KEY",
    );
  }
  if (
    plan.environments.length > 500 ||
    plan.projectVariables.length > 2_000 ||
    plan.authProfiles.length > 500
  ) {
    throw new CollectionImportError(
      "The import source contains too many configuration records.",
      "IMPORT_CONFIGURATION_LIMIT",
    );
  }
  const validateVariables = (variables: PortableImportVariable[]) => {
    if (variables.length > 2_000) {
      throw new CollectionImportError(
        "An imported variable scope contains more than 2,000 variables.",
        "IMPORT_VARIABLE_LIMIT",
      );
    }
    if (
      variables.some(
        ({ name, value }) => name.length > 128 || value.length > 1_048_576,
      )
    ) {
      throw new CollectionImportError(
        "An imported variable exceeds the supported name or value size.",
        "IMPORT_VARIABLE_SIZE_LIMIT",
      );
    }
  };
  validateVariables(plan.projectVariables);
  plan.environments.forEach((environment) =>
    validateVariables(environment.variables),
  );
  let requests: PortableImportRequest[];
  try {
    requests = plan.requests.map((request) => {
      if (request.folderPath.length > 32 || request.url.length > 8_192) {
        throw new CollectionImportError(
          "An imported request exceeds the supported folder depth or URL size.",
          "IMPORT_REQUEST_SIZE_LIMIT",
        );
      }
      return {
        ...request,
        queryParameters: requestFieldSchema
          .array()
          .max(200)
          .parse(request.queryParameters),
        headers: requestFieldSchema.array().max(200).parse(request.headers),
        body: requestBodySchema.parse(request.body),
        settings: parseRequestSettings(request.settings),
      };
    });
  } catch (error) {
    if (error instanceof CollectionImportError) throw error;
    throw new CollectionImportError(
      `An imported request exceeds the supported field limits: ${error instanceof Error ? error.message : "validation failed"}`,
      "IMPORT_REQUEST_FIELD_LIMIT",
    );
  }
  return {
    ...plan,
    requests,
    sourceHash: hashImportValue(source),
    warnings: [...new Set(plan.warnings)],
    unsupported: [...new Set(plan.unsupported)],
  } satisfies PortableImportPlan;
}
