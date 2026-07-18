import { z } from "zod";

import {
  httpMethodSchema,
  requestBodySchema,
  requestFieldSchema,
} from "@/features/requests/domain";
import { entityIdSchema, entityNameSchema } from "@/features/workspaces/domain";

export const MAX_OPENAPI_DOCUMENT_BYTES = 2 * 1_024 * 1_024;
export const MAX_OPENAPI_OPERATIONS = 2_000;

export const openApiSourceTypeSchema = z.enum(["file", "paste", "url"]);
export type OpenApiSourceType = z.infer<typeof openApiSourceTypeSchema>;

export const openApiSourceSchema = z
  .object({
    sourceType: openApiSourceTypeSchema,
    content: z
      .string()
      .max(
        MAX_OPENAPI_DOCUMENT_BYTES,
        "OpenAPI documents must be 2 MiB or smaller.",
      )
      .optional(),
    sourceUrl: z.string().trim().max(8_192).optional(),
    allowPrivateNetwork: z.boolean().default(false),
  })
  .superRefine((value, context) => {
    if (value.sourceType === "url") {
      if (!value.content && !value.sourceUrl) {
        context.addIssue({
          code: "custom",
          message: "Enter the OpenAPI source URL.",
          path: ["sourceUrl"],
        });
      }
    } else if (!value.content?.trim()) {
      context.addIssue({
        code: "custom",
        message: "Choose or paste an OpenAPI document.",
        path: ["content"],
      });
    }
  });

const tagFolderSchema = z.record(z.string().min(1).max(120), entityNameSchema);

export const openApiImportOptionsSchema = z.object({
  name: entityNameSchema,
  selectedOperationKeys: z
    .array(z.string().min(1).max(8_192))
    .min(1, "Select at least one operation.")
    .max(MAX_OPENAPI_OPERATIONS),
  tagFolders: tagFolderSchema,
  createServerVariable: z.boolean().default(true),
  serverVariableName: z
    .string()
    .trim()
    .regex(
      /^[A-Za-z_][A-Za-z0-9._-]{0,119}$/,
      "Server variable names may contain letters, numbers, dots, dashes, and underscores.",
    )
    .default("baseUrl"),
  createAuthProfiles: z.boolean().default(true),
  conflictStrategy: z.enum(["rename", "replace", "skip"]).default("rename"),
});

export const executeOpenApiImportSchema = z.object({
  projectId: entityIdSchema,
  source: openApiSourceSchema,
  options: openApiImportOptionsSchema,
});

export const previewOpenApiImportSchema = z.object({
  projectId: entityIdSchema,
  source: openApiSourceSchema,
});

export const previewOpenApiRefreshSchema = z.object({
  definitionId: entityIdSchema,
  source: openApiSourceSchema,
});

export const applyOpenApiRefreshSchema = z.object({
  definitionId: entityIdSchema,
  source: openApiSourceSchema,
  selectedChangeKeys: z
    .array(z.string().min(1).max(8_192))
    .max(MAX_OPENAPI_OPERATIONS + 10),
});

export const importedDefinitionIdSchema = z.object({
  definitionId: entityIdSchema,
});

export const importedRequestIdSchema = z.object({ requestId: entityIdSchema });

export interface OpenApiServer {
  url: string;
  resolvedUrl: string;
  description: string | null;
  variables: Record<string, { default: string; description: string | null }>;
}

export interface OpenApiSecurityProposal {
  schemeName: string;
  name: string;
  type:
    | "bearer"
    | "basic"
    | "api_key_header"
    | "api_key_query"
    | "oauth2_client_credentials"
    | "oauth2_password";
  configuration: Record<string, string>;
  supported: boolean;
  warning: string | null;
}

export interface GeneratedOpenApiRequest {
  name: string;
  description: string;
  method: z.infer<typeof httpMethodSchema>;
  url: string;
  tags: string[];
  queryParameters: Array<z.infer<typeof requestFieldSchema>>;
  headers: Array<z.infer<typeof requestFieldSchema>>;
  requestVariables: Array<{
    name: string;
    value: string;
    enabled: boolean;
    secret: boolean;
  }>;
  body: z.infer<typeof requestBodySchema>;
}

export interface OpenApiOperationPreview {
  sourceKey: string;
  method: z.infer<typeof httpMethodSchema>;
  path: string;
  operationId: string | null;
  name: string;
  summary: string | null;
  description: string | null;
  tags: string[];
  primaryTag: string;
  deprecated: boolean;
  securitySchemeNames: string[];
  serverUrl: string;
  generatedRequest: GeneratedOpenApiRequest;
  operation: Record<string, unknown>;
  operationHash: string;
  warnings: string[];
  conflict: string | null;
}

export interface ParsedOpenApiDefinition {
  format: "openapi_json" | "openapi_yaml";
  originalDocument: string;
  sourceHash: string;
  openapiVersion: string;
  title: string;
  apiVersion: string | null;
  servers: OpenApiServer[];
  tags: Array<{ name: string; description: string | null }>;
  securitySchemes: Record<string, Record<string, unknown>>;
  securityProposals: OpenApiSecurityProposal[];
  schemas: Record<string, unknown>;
  globalSecurity: unknown[];
  operations: OpenApiOperationPreview[];
  warnings: string[];
}

export interface OpenApiImportPreview extends ParsedOpenApiDefinition {
  projectId: string;
  existingDefinitionId: string | null;
  conflicts: string[];
}

export type OpenApiChangeCategory =
  "added" | "removed" | "changed" | "servers" | "security_schemes" | "schemas";

export interface OpenApiDiffItem {
  key: string;
  category: OpenApiChangeCategory;
  sourceKey: string | null;
  label: string;
  details: string[];
  customized: boolean;
}

export interface OpenApiRefreshPreview {
  definitionId: string;
  definitionName: string;
  source: ParsedOpenApiDefinition;
  changes: OpenApiDiffItem[];
  unchangedOperationCount: number;
}

export interface ImportedDefinitionSummary {
  id: string;
  projectId: string;
  name: string;
  format: "openapi_json" | "openapi_yaml";
  sourceType: OpenApiSourceType;
  sourceUrl: string | null;
  allowPrivateNetwork: boolean;
  openapiVersion: string | null;
  title: string | null;
  apiVersion: string | null;
  operationCount: number;
  linkedRequestCount: number;
  customizedRequestCount: number;
  importedAt: string;
  updatedAt: string;
}

export interface OpenApiImportResult {
  definitionId: string;
  createdRequests: number;
  replacedRequests: number;
  skippedRequests: number;
  createdFolders: number;
  createdAuthProfiles: number;
  serverVariableName: string | null;
  warnings: string[];
}

export interface OpenApiRefreshResult {
  definitionId: string;
  added: number;
  updated: number;
  removed: number;
  preservedCustomRequests: number;
  warnings: string[];
}

export type OpenApiActionResult<T> =
  { ok: true; data: T } | { ok: false; error: string };

export class OpenApiDomainError extends Error {
  constructor(
    message: string,
    public readonly code = "OPENAPI_INVALID",
  ) {
    super(message);
    this.name = "OpenApiDomainError";
  }
}
