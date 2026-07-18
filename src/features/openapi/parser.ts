import { createHash } from "node:crypto";

import { parseDocument } from "yaml";

import { httpMethods } from "@/features/requests/domain";

import {
  type GeneratedOpenApiRequest,
  MAX_OPENAPI_DOCUMENT_BYTES,
  MAX_OPENAPI_OPERATIONS,
  type OpenApiDiffItem,
  OpenApiDomainError,
  type OpenApiOperationPreview,
  type OpenApiSecurityProposal,
  type OpenApiServer,
  type ParsedOpenApiDefinition,
} from "./domain";

type JsonObject = Record<string, unknown>;

const operationMethods = new Set<string>(
  httpMethods.map((method) => method.toLocaleLowerCase()),
);
const sensitiveFieldName = /(authorization|api[-_]?key|password|secret|token)/i;
const MAX_DOCUMENT_DEPTH = 80;
const MAX_DOCUMENT_NODES = 100_000;
const MAX_EXAMPLE_DEPTH = 12;
const prohibitedMappingKeys = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objectValue(value: unknown): JsonObject {
  return isObject(value) ? value : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function optionalText(value: unknown) {
  const text = stringValue(value)?.trim();
  return text ? text : null;
}

function sortedValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortedValue(value[key])]),
  );
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(sortedValue(value));
}

export function hashOpenApiValue(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function assertSafeDocument(value: unknown) {
  let nodes = 0;
  const seen = new WeakSet<object>();

  const visit = (current: unknown, depth: number) => {
    nodes += 1;
    if (nodes > MAX_DOCUMENT_NODES) {
      throw new OpenApiDomainError(
        "The OpenAPI document is too complex to import safely.",
        "OPENAPI_COMPLEXITY_LIMIT",
      );
    }
    if (depth > MAX_DOCUMENT_DEPTH) {
      throw new OpenApiDomainError(
        "The OpenAPI document is nested too deeply.",
        "OPENAPI_DEPTH_LIMIT",
      );
    }
    if (typeof current === "number" && !Number.isFinite(current)) {
      throw new OpenApiDomainError("The document contains an invalid number.");
    }
    if (!current || typeof current !== "object") return;
    if (seen.has(current)) return;
    seen.add(current);

    if (Array.isArray(current)) {
      current.forEach((item) => visit(item, depth + 1));
      return;
    }
    for (const [key, child] of Object.entries(current)) {
      if (prohibitedMappingKeys.has(key)) {
        throw new OpenApiDomainError(
          "The document contains a prohibited mapping key.",
          "OPENAPI_PROTOTYPE_KEY",
        );
      }
      visit(child, depth + 1);
    }
  };

  visit(value, 0);
}

function parseDocumentValue(input: string) {
  if (Buffer.byteLength(input, "utf8") > MAX_OPENAPI_DOCUMENT_BYTES) {
    throw new OpenApiDomainError(
      "OpenAPI documents must be 2 MiB or smaller.",
      "OPENAPI_SIZE_LIMIT",
    );
  }
  const source = input.replace(/^\uFEFF/, "").trim();
  if (!source) throw new OpenApiDomainError("The OpenAPI document is empty.");

  const looksJson = source.startsWith("{");
  let value: unknown;
  if (looksJson) {
    try {
      value = JSON.parse(source) as unknown;
    } catch (error) {
      throw new OpenApiDomainError(
        `The OpenAPI JSON is invalid: ${error instanceof Error ? error.message : "parse failed"}`,
        "OPENAPI_JSON_INVALID",
      );
    }
  } else {
    const document = parseDocument(source, {
      customTags: [],
      merge: false,
      prettyErrors: true,
      schema: "core",
      strict: true,
      stringKeys: true,
      uniqueKeys: true,
      version: "1.2",
    });
    if (document.errors.length) {
      throw new OpenApiDomainError(
        `The OpenAPI YAML is invalid: ${document.errors[0]?.message ?? "parse failed"}`,
        "OPENAPI_YAML_INVALID",
      );
    }
    try {
      value = document.toJS({ maxAliasCount: 25 });
    } catch (error) {
      throw new OpenApiDomainError(
        `The OpenAPI YAML could not be expanded safely: ${error instanceof Error ? error.message : "alias limit exceeded"}`,
        "OPENAPI_YAML_ALIAS_LIMIT",
      );
    }
  }
  assertSafeDocument(value);
  if (!isObject(value)) {
    throw new OpenApiDomainError(
      "The OpenAPI document root must be an object.",
    );
  }
  return {
    value,
    format: looksJson ? ("openapi_json" as const) : ("openapi_yaml" as const),
  };
}

function decodePointerPart(value: string) {
  return decodeURIComponent(value).replaceAll("~1", "/").replaceAll("~0", "~");
}

function resolveLocalReference(
  value: unknown,
  root: JsonObject,
  warnings: string[],
): JsonObject {
  if (!isObject(value)) return {};
  const reference = stringValue(value.$ref);
  if (!reference) return value;
  if (!reference.startsWith("#/")) {
    warnings.push(
      `External reference ${reference} was retained but not fetched.`,
    );
    return value;
  }
  let current: unknown = root;
  for (const part of reference.slice(2).split("/")) {
    if (!isObject(current) && !Array.isArray(current)) return value;
    current = (current as Record<string, unknown>)[decodePointerPart(part)];
  }
  if (!isObject(current)) return value;
  const siblings = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "$ref"),
  );
  return { ...current, ...siblings };
}

function normaliseVariableName(input: string, fallback: string) {
  const replaced = input.trim().replace(/[^A-Za-z0-9_.-]/g, "_");
  const prefixed = /^[A-Za-z_]/.test(replaced) ? replaced : `_${replaced}`;
  return (prefixed || fallback).slice(0, 128);
}

function exampleFromSchema(
  input: unknown,
  root: JsonObject,
  warnings: string[],
  depth = 0,
  references = new Set<string>(),
): unknown {
  if (depth > MAX_EXAMPLE_DEPTH) return null;
  if (!isObject(input)) return null;
  const reference = stringValue(input.$ref);
  if (reference) {
    if (references.has(reference)) return null;
    references = new Set(references).add(reference);
  }
  const schema = resolveLocalReference(input, root, warnings);
  if ("example" in schema) return schema.example;
  if ("default" in schema) return schema.default;
  const examples = arrayValue(schema.examples);
  if (examples.length) return examples[0];
  const values = arrayValue(schema.enum);
  if (values.length) return values[0];

  for (const composition of ["oneOf", "anyOf", "allOf"] as const) {
    const candidates = arrayValue(schema[composition]);
    if (candidates.length) {
      if (composition === "allOf") {
        return candidates.reduce<JsonObject>((result, candidate) => {
          const example = exampleFromSchema(
            candidate,
            root,
            warnings,
            depth + 1,
            references,
          );
          return isObject(example) ? { ...result, ...example } : result;
        }, {});
      }
      return exampleFromSchema(
        candidates[0],
        root,
        warnings,
        depth + 1,
        references,
      );
    }
  }

  const type = stringValue(schema.type);
  if (type === "object" || isObject(schema.properties)) {
    return Object.fromEntries(
      Object.entries(objectValue(schema.properties))
        .slice(0, 100)
        .map(([key, property]) => [
          key,
          exampleFromSchema(property, root, warnings, depth + 1, references),
        ]),
    );
  }
  if (type === "array") {
    return [
      exampleFromSchema(schema.items, root, warnings, depth + 1, references),
    ];
  }
  if (type === "integer" || type === "number") return 0;
  if (type === "boolean") return false;
  if (type === "string") {
    switch (schema.format) {
      case "date":
        return "2026-01-01";
      case "date-time":
        return "2026-01-01T00:00:00Z";
      case "email":
        return "person@example.test";
      case "uuid":
        return "00000000-0000-4000-8000-000000000000";
      case "uri":
      case "url":
        return "https://example.test";
      default:
        return "string";
    }
  }
  return null;
}

function parameterExample(
  parameter: JsonObject,
  root: JsonObject,
  warnings: string[],
) {
  const value =
    parameter.example ??
    exampleFromSchema(parameter.schema, root, warnings) ??
    "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function resolveServer(server: unknown): OpenApiServer | null {
  if (!isObject(server)) return null;
  const url = stringValue(server.url)?.trim();
  if (!url) return null;
  const variables = Object.fromEntries(
    Object.entries(objectValue(server.variables)).map(([name, raw]) => {
      const variable = objectValue(raw);
      return [
        name,
        {
          default: String(variable.default ?? ""),
          description: optionalText(variable.description),
        },
      ];
    }),
  );
  const resolvedUrl = url.replace(/\{([^{}]+)}/g, (_match, name: string) =>
    encodeURIComponent(variables[name]?.default ?? ""),
  );
  return {
    url,
    resolvedUrl,
    description: optionalText(server.description),
    variables,
  };
}

function joinServerAndPath(server: string, path: string) {
  const base = server.replace(/\/$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  if (/^https?:\/\//i.test(base)) return `${base}${suffix}`;
  return `https://example.test${base.startsWith("/") ? base : `/${base}`}${suffix}`;
}

function securityProposals(
  schemes: JsonObject,
  root: JsonObject,
  warnings: string[],
) {
  return Object.entries(schemes).map(([name, raw]): OpenApiSecurityProposal => {
    const scheme = resolveLocalReference(raw, root, warnings);
    const type = stringValue(scheme.type);
    if (type === "apiKey") {
      const location = stringValue(scheme.in);
      if (location !== "query" && location !== "header") {
        const warning = `Security scheme ${name} uses unsupported API-key location ${location ?? "unknown"} and was retained without a generated profile.`;
        warnings.push(warning);
        return {
          schemeName: name,
          name,
          type: "api_key_header",
          configuration: {
            headerName: stringValue(scheme.name) ?? "X-API-Key",
            key: "",
          },
          supported: false,
          warning,
        };
      }
      const target = location;
      const fieldName = stringValue(scheme.name) || "X-API-Key";
      const configuration: Record<string, string> =
        target === "query"
          ? { queryName: fieldName, key: "" }
          : { headerName: fieldName, key: "" };
      return {
        schemeName: name,
        name,
        type: target === "query" ? "api_key_query" : "api_key_header",
        configuration,
        supported: true,
        warning: null,
      };
    }
    if (type === "http") {
      const schemeName = stringValue(scheme.scheme)?.toLocaleLowerCase();
      if (schemeName === "basic") {
        return {
          schemeName: name,
          name,
          type: "basic",
          configuration: { username: "", password: "" },
          supported: true,
          warning: null,
        };
      }
      if (schemeName === "bearer") {
        return {
          schemeName: name,
          name,
          type: "bearer",
          configuration: { token: "", tokenPrefix: "Bearer" },
          supported: true,
          warning: null,
        };
      }
    }
    if (type === "oauth2") {
      const flows = objectValue(scheme.flows);
      const client = objectValue(flows.clientCredentials);
      if (Object.keys(client).length) {
        return {
          schemeName: name,
          name,
          type: "oauth2_client_credentials",
          configuration: {
            tokenUrl: stringValue(client.tokenUrl) ?? "",
            scope: Object.keys(objectValue(client.scopes)).join(" "),
            clientId: "",
            clientSecret: "",
          },
          supported: true,
          warning: null,
        };
      }
      const password = objectValue(flows.password);
      if (Object.keys(password).length) {
        return {
          schemeName: name,
          name,
          type: "oauth2_password",
          configuration: {
            tokenUrl: stringValue(password.tokenUrl) ?? "",
            scope: Object.keys(objectValue(password.scopes)).join(" "),
            username: "",
            password: "",
          },
          supported: true,
          warning: null,
        };
      }
    }
    const warning = `Security scheme ${name} uses unsupported type or flow and was retained without a generated profile.`;
    warnings.push(warning);
    return {
      schemeName: name,
      name,
      type: "bearer",
      configuration: { token: "", tokenPrefix: "Bearer" },
      supported: false,
      warning,
    };
  });
}

function buildRequestBody(
  operation: JsonObject,
  root: JsonObject,
  warnings: string[],
): GeneratedOpenApiRequest["body"] {
  const requestBody = resolveLocalReference(
    operation.requestBody,
    root,
    warnings,
  );
  const content = objectValue(requestBody.content);
  const preferred =
    [
      "application/json",
      "application/*+json",
      "application/x-www-form-urlencoded",
      "multipart/form-data",
      "text/plain",
      "application/xml",
      "text/xml",
    ].find((type) => type in content) ?? Object.keys(content)[0];
  if (!preferred) {
    return { type: "none", content: null, contentType: null, metadata: {} };
  }
  const media = objectValue(content[preferred]);
  const example =
    media.example ?? exampleFromSchema(media.schema, root, warnings) ?? null;
  if (preferred === "application/x-www-form-urlencoded") {
    const fields = isObject(example)
      ? Object.entries(example)
          .map(([key, value]) => `${key}=${String(value ?? "")}`)
          .join("\n")
      : "";
    return {
      type: "form_urlencoded",
      content: fields,
      contentType: preferred,
      metadata: {},
    };
  }
  if (preferred === "multipart/form-data") {
    const parts = isObject(example)
      ? Object.entries(example).map(([name, value]) => ({
          name,
          value: String(value ?? ""),
        }))
      : [];
    return {
      type: "multipart",
      content: JSON.stringify(parts, null, 2),
      contentType: preferred,
      metadata: {},
    };
  }
  if (preferred.includes("json")) {
    return {
      type: "json",
      content: JSON.stringify(example ?? {}, null, 2),
      contentType: preferred,
      metadata: {},
    };
  }
  if (preferred.includes("xml")) {
    return {
      type: "xml",
      content: typeof example === "string" ? example : "<root />",
      contentType: preferred,
      metadata: {},
    };
  }
  return {
    type: "text",
    content: typeof example === "string" ? example : String(example ?? ""),
    contentType: preferred,
    metadata: {},
  };
}

function securityNames(value: unknown) {
  const names = new Set<string>();
  for (const requirement of arrayValue(value)) {
    Object.keys(objectValue(requirement)).forEach((name) => names.add(name));
  }
  return [...names];
}

function operationPreview(
  method: string,
  path: string,
  pathItem: JsonObject,
  operation: JsonObject,
  root: JsonObject,
  documentServers: OpenApiServer[],
  globalSecurity: unknown[],
): OpenApiOperationPreview {
  const warnings: string[] = [];
  const parameterMap = new Map<string, JsonObject>();
  for (const rawParameter of [
    ...arrayValue(pathItem.parameters),
    ...arrayValue(operation.parameters),
  ]) {
    const parameter = resolveLocalReference(rawParameter, root, warnings);
    const key = `${stringValue(parameter.in) ?? ""}:${stringValue(parameter.name) ?? ""}`;
    parameterMap.set(key, parameter);
  }
  const parameters = [...parameterMap.values()];
  const rawServers = arrayValue(operation.servers).length
    ? arrayValue(operation.servers)
    : arrayValue(pathItem.servers).length
      ? arrayValue(pathItem.servers)
      : documentServers;
  const servers = rawServers
    .map(resolveServer)
    .filter((server): server is OpenApiServer => Boolean(server));
  const server = servers[0] ?? {
    url: "https://example.test",
    resolvedUrl: "https://example.test",
    description: null,
    variables: {},
  };
  if (!servers.length) {
    warnings.push(
      "No usable server URL was supplied; https://example.test is used as a placeholder.",
    );
  }

  const requestVariables: GeneratedOpenApiRequest["requestVariables"] = [];
  const queryParameters: GeneratedOpenApiRequest["queryParameters"] = [];
  const headers: GeneratedOpenApiRequest["headers"] = [];
  let generatedPath = path;

  for (const parameter of parameters) {
    const name = stringValue(parameter.name)?.trim();
    const location = stringValue(parameter.in);
    if (!name || !location) continue;
    const example = parameterExample(parameter, root, warnings);
    if (location === "path") {
      const variableName = normaliseVariableName(name, "pathParameter");
      generatedPath = generatedPath.replaceAll(
        `{${name}}`,
        `{{${variableName}}}`,
      );
      requestVariables.push({
        name: variableName,
        value: example,
        enabled: true,
        secret: sensitiveFieldName.test(name),
      });
    } else if (location === "query") {
      queryParameters.push({
        name,
        value: example,
        enabled: Boolean(parameter.required) || example !== "",
        secret: sensitiveFieldName.test(name),
      });
    } else if (location === "header") {
      headers.push({
        name,
        value: example,
        enabled: Boolean(parameter.required) || example !== "",
        secret: sensitiveFieldName.test(name),
      });
    } else if (location === "cookie") {
      warnings.push(
        `Cookie parameter ${name} was retained in the operation snapshot but was not generated as a saved cookie.`,
      );
    }
  }

  generatedPath = generatedPath.replace(
    /(?<!\{)\{([^{}]+)\}(?!\})/g,
    (_match, name: string) => {
      const variableName = normaliseVariableName(name, "pathParameter");
      if (
        !requestVariables.some((variable) => variable.name === variableName)
      ) {
        requestVariables.push({
          name: variableName,
          value: "",
          enabled: true,
          secret: sensitiveFieldName.test(name),
        });
        warnings.push(
          `Path placeholder ${name} has no parameter definition; an empty request variable was generated.`,
        );
      }
      return `{{${variableName}}}`;
    },
  );

  const tags = arrayValue(operation.tags)
    .filter(
      (tag): tag is string => typeof tag === "string" && tag.trim() !== "",
    )
    .map((tag) => tag.trim());
  const primaryTag = tags[0] ?? "Other";
  const upperMethod =
    method.toLocaleUpperCase() as OpenApiOperationPreview["method"];
  const operationId = optionalText(operation.operationId);
  const summary = optionalText(operation.summary);
  const name = (summary || operationId || `${upperMethod} ${path}`).slice(
    0,
    120,
  );
  const security =
    "security" in operation ? operation.security : globalSecurity;
  const snapshot = {
    parameters,
    requestBody: operation.requestBody ?? null,
    responses: operation.responses ?? {},
    security,
    servers: rawServers,
    summary: operation.summary ?? null,
    description: operation.description ?? null,
    operationId: operation.operationId ?? null,
    tags,
    deprecated: operation.deprecated ?? false,
  };
  return {
    sourceKey: `${upperMethod} ${path}`,
    method: upperMethod,
    path,
    operationId,
    name,
    summary,
    description: optionalText(operation.description),
    tags,
    primaryTag,
    deprecated: operation.deprecated === true,
    securitySchemeNames: securityNames(security),
    serverUrl: server.resolvedUrl,
    generatedRequest: {
      name,
      description: optionalText(operation.description) ?? "",
      method: upperMethod,
      url: joinServerAndPath(server.resolvedUrl, generatedPath),
      tags,
      queryParameters,
      headers,
      requestVariables,
      body: buildRequestBody(operation, root, warnings),
    },
    operation: snapshot,
    operationHash: hashOpenApiValue(snapshot),
    warnings: [...new Set(warnings)],
    conflict: null,
  };
}

export function parseOpenApiDocument(input: string): ParsedOpenApiDefinition {
  const parsed = parseDocumentValue(input);
  const root = parsed.value;
  const openapiVersion = stringValue(root.openapi)?.trim() ?? "";
  if (!/^3\.\d+(?:\.\d+)?(?:[-+].*)?$/.test(openapiVersion)) {
    throw new OpenApiDomainError(
      "Only OpenAPI 3.x documents are supported.",
      "OPENAPI_VERSION_UNSUPPORTED",
    );
  }
  const info = objectValue(root.info);
  const title = optionalText(info.title);
  if (!title) throw new OpenApiDomainError("OpenAPI info.title is required.");

  const warnings: string[] = [];
  const documentServers = arrayValue(root.servers)
    .map(resolveServer)
    .filter((server): server is OpenApiServer => Boolean(server));
  const globalSecurity = arrayValue(root.security);
  const components = objectValue(root.components);
  const schemes = objectValue(components.securitySchemes);
  const proposals = securityProposals(schemes, root, warnings);
  const operations: OpenApiOperationPreview[] = [];

  for (const [path, rawPathItem] of Object.entries(objectValue(root.paths))) {
    if (!path.startsWith("/") || !isObject(rawPathItem)) continue;
    const pathItem = resolveLocalReference(rawPathItem, root, warnings);
    for (const [method, rawOperation] of Object.entries(pathItem)) {
      if (
        !operationMethods.has(method.toLocaleLowerCase()) ||
        !isObject(rawOperation)
      )
        continue;
      operations.push(
        operationPreview(
          method,
          path,
          pathItem,
          rawOperation,
          root,
          documentServers,
          globalSecurity,
        ),
      );
      if (operations.length > MAX_OPENAPI_OPERATIONS) {
        throw new OpenApiDomainError(
          `OpenAPI imports are limited to ${MAX_OPENAPI_OPERATIONS} operations.`,
          "OPENAPI_OPERATION_LIMIT",
        );
      }
    }
  }
  if (!operations.length) {
    throw new OpenApiDomainError(
      "The OpenAPI document does not contain any supported HTTP operations.",
      "OPENAPI_NO_OPERATIONS",
    );
  }
  operations.sort(
    (left, right) =>
      left.primaryTag.localeCompare(right.primaryTag) ||
      left.path.localeCompare(right.path) ||
      left.method.localeCompare(right.method),
  );

  return {
    format: parsed.format,
    originalDocument: input,
    sourceHash: hashOpenApiValue(root),
    openapiVersion,
    title,
    apiVersion: optionalText(info.version),
    servers: documentServers,
    tags: arrayValue(root.tags)
      .map(objectValue)
      .map((tag) => ({
        name: optionalText(tag.name) ?? "",
        description: optionalText(tag.description),
      }))
      .filter(({ name }) => Boolean(name)),
    securitySchemes: schemes as Record<string, Record<string, unknown>>,
    securityProposals: proposals,
    schemas: objectValue(components.schemas),
    globalSecurity,
    operations,
    warnings: [
      ...new Set([...warnings, ...operations.flatMap((item) => item.warnings)]),
    ],
  };
}

export function materialiseOpenApiRequest(
  operation: OpenApiOperationPreview,
  serverVariableName: string | null,
) {
  const request: GeneratedOpenApiRequest = {
    ...operation.generatedRequest,
    tags: [...operation.generatedRequest.tags],
    queryParameters: operation.generatedRequest.queryParameters.map((item) => ({
      ...item,
    })),
    headers: operation.generatedRequest.headers.map((item) => ({ ...item })),
    requestVariables: operation.generatedRequest.requestVariables.map(
      (item) => ({
        ...item,
      }),
    ),
    body: {
      ...operation.generatedRequest.body,
      metadata: { ...operation.generatedRequest.body.metadata },
    },
  };
  if (serverVariableName && request.url.startsWith(operation.serverUrl)) {
    request.url = `{{${serverVariableName}}}${request.url.slice(operation.serverUrl.length)}`;
  }
  return request;
}

function operationChangeDetails(
  previous: OpenApiOperationPreview,
  next: OpenApiOperationPreview,
) {
  const details: string[] = [];
  const fields: Array<[keyof OpenApiOperationPreview["operation"], string]> = [
    ["parameters", "Parameters changed"],
    ["requestBody", "Request body changed"],
    ["responses", "Response schemas changed"],
    ["security", "Authentication requirements changed"],
    ["servers", "Operation servers changed"],
  ];
  for (const [field, label] of fields) {
    if (
      hashOpenApiValue(previous.operation[field]) !==
      hashOpenApiValue(next.operation[field])
    ) {
      details.push(label);
    }
  }
  if (!details.length) details.push("Operation metadata changed");
  return details;
}

export function diffOpenApiDefinitions(
  previous: ParsedOpenApiDefinition,
  next: ParsedOpenApiDefinition,
  customized = new Set<string>(),
) {
  const changes: OpenApiDiffItem[] = [];
  const previousOperations = new Map(
    previous.operations.map((operation) => [operation.sourceKey, operation]),
  );
  const nextOperations = new Map(
    next.operations.map((operation) => [operation.sourceKey, operation]),
  );
  let unchangedOperationCount = 0;

  for (const operation of next.operations) {
    const existing = previousOperations.get(operation.sourceKey);
    if (!existing) {
      changes.push({
        key: `operation:${operation.sourceKey}`,
        category: "added",
        sourceKey: operation.sourceKey,
        label: `${operation.method} ${operation.path}`,
        details: ["Operation added"],
        customized: false,
      });
    } else if (existing.operationHash !== operation.operationHash) {
      changes.push({
        key: `operation:${operation.sourceKey}`,
        category: "changed",
        sourceKey: operation.sourceKey,
        label: `${operation.method} ${operation.path}`,
        details: operationChangeDetails(existing, operation),
        customized: customized.has(operation.sourceKey),
      });
    } else {
      unchangedOperationCount += 1;
    }
  }
  for (const operation of previous.operations) {
    if (!nextOperations.has(operation.sourceKey)) {
      changes.push({
        key: `operation:${operation.sourceKey}`,
        category: "removed",
        sourceKey: operation.sourceKey,
        label: `${operation.method} ${operation.path}`,
        details: ["Operation removed"],
        customized: customized.has(operation.sourceKey),
      });
    }
  }
  const globals: Array<{
    key: "servers" | "security_schemes" | "schemas";
    previous: unknown;
    next: unknown;
    label: string;
  }> = [
    {
      key: "servers",
      previous: previous.servers,
      next: next.servers,
      label: "Server definitions changed",
    },
    {
      key: "security_schemes",
      previous: previous.securitySchemes,
      next: next.securitySchemes,
      label: "Security schemes changed",
    },
    {
      key: "schemas",
      previous: previous.schemas,
      next: next.schemas,
      label: "Component schemas changed",
    },
  ];
  for (const global of globals) {
    if (hashOpenApiValue(global.previous) !== hashOpenApiValue(global.next)) {
      changes.push({
        key: global.key,
        category: global.key,
        sourceKey: null,
        label: global.label,
        details: [global.label],
        customized: false,
      });
    }
  }
  return { changes, unchangedOperationCount };
}
