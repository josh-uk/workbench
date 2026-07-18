import { z } from "zod";

import {
  entityDescriptionSchema,
  entityIdSchema,
  entityNameSchema,
} from "@/features/workspaces/domain";
import {
  runtimeVariablesSchema,
  type VariableValue,
  variableValuesSchema,
} from "@/features/variables/domain";

export const httpMethods = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const;

export const requestBodyTypes = [
  "none",
  "json",
  "text",
  "xml",
  "form_urlencoded",
  "multipart",
  "binary",
] as const;

export const httpMethodSchema = z.enum(httpMethods);
export const requestBodyTypeSchema = z.enum(requestBodyTypes);

const fieldNameSchema = z
  .string()
  .trim()
  .min(1, "Field name is required.")
  .max(256, "Field name must be 256 characters or fewer.");

const fieldValueSchema = z
  .string()
  .max(1_048_576, "Field value must be 1 MiB or smaller.");

export const requestFieldSchema = z.object({
  name: fieldNameSchema,
  value: fieldValueSchema.default(""),
  enabled: z.boolean().default(true),
  secret: z.boolean().default(false),
});

export const requestCookieSchema = requestFieldSchema
  .omit({ secret: true })
  .extend({
    secret: z.boolean().default(true),
  });

export const requestSettingsSchema = z.object({
  timeoutMs: z.number().int().min(100).max(120_000).default(30_000),
  followRedirects: z.boolean().default(true),
  maxRedirects: z.number().int().min(0).max(10).default(5),
  tlsVerify: z.boolean().default(true),
  maxResponseBytes: z
    .number()
    .int()
    .min(1_024)
    .max(10 * 1_024 * 1_024)
    .default(1_048_576),
  allowPrivateNetwork: z.boolean().default(false),
  cookies: z.array(requestCookieSchema).max(100).default([]),
  workspaceEnvironmentId: entityIdSchema.nullable().optional(),
  projectEnvironmentId: entityIdSchema.nullable().optional(),
});

export const requestBodySchema = z.object({
  type: requestBodyTypeSchema.default("none"),
  content: z
    .string()
    .max(2 * 1_024 * 1_024, "Request body must be 2 MiB or smaller.")
    .nullable()
    .default(null),
  contentType: z.string().trim().max(256).nullable().default(null),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const createSavedRequestSchema = z.object({
  projectId: entityIdSchema,
  folderId: entityIdSchema.nullable().default(null),
  name: entityNameSchema.default("New request"),
  method: httpMethodSchema.default("GET"),
  url: z.string().trim().min(1, "URL is required.").max(8_192),
});

export const updateSavedRequestSchema = z.object({
  id: entityIdSchema,
  name: entityNameSchema,
  description: entityDescriptionSchema.default(""),
  method: httpMethodSchema,
  url: z.string().trim().min(1, "URL is required.").max(8_192),
  folderId: entityIdSchema.nullable(),
  tags: z.array(z.string().trim().min(1).max(64)).max(50).default([]),
  queryParameters: z.array(requestFieldSchema.omit({ secret: true })).max(200),
  headers: z.array(requestFieldSchema).max(200),
  requestVariables: variableValuesSchema.default([]),
  body: requestBodySchema,
  settings: requestSettingsSchema,
});

export const requestIdSchema = z.object({ requestId: entityIdSchema });

export const moveSavedRequestSchema = requestIdSchema.extend({
  direction: z.enum(["up", "down"]),
});

export const relocateSavedRequestSchema = requestIdSchema.extend({
  folderId: entityIdSchema.nullable(),
});

export const executeSavedRequestSchema = z.object({
  executionId: entityIdSchema,
  runtimeVariables: runtimeVariablesSchema,
});

export const resolveSavedRequestSchema = z.object({
  runtimeVariables: runtimeVariablesSchema,
});

export interface RequestField {
  name: string;
  value: string;
  enabled: boolean;
  secret: boolean;
}

export interface RequestBody {
  type: (typeof requestBodyTypes)[number];
  content: string | null;
  contentType: string | null;
  metadata: Record<string, unknown>;
}

export type RequestSettings = z.infer<typeof requestSettingsSchema>;

export interface SavedRequestSummary {
  id: string;
  projectId: string;
  folderId: string | null;
  name: string;
  method: (typeof httpMethods)[number];
  position: number;
}

export interface SavedRequestDetail extends SavedRequestSummary {
  description: string | null;
  url: string;
  tags: string[];
  queryParameters: RequestField[];
  headers: RequestField[];
  requestVariables: VariableValue[];
  availableEnvironments: {
    workspace: Array<{ id: string; name: string }>;
    project: Array<{ id: string; name: string }>;
  };
  body: RequestBody;
  settings: RequestSettings;
  history: ExecutionDetail[];
}

export interface ResponseHeader {
  name: string;
  value: string;
}

export interface ResponseCookie {
  name: string;
  value: string;
  attributes: string[];
}

export interface RedirectHop {
  statusCode: number;
  url: string;
  location: string;
}

export interface ExecutionDetail {
  id: string;
  requestId: string | null;
  projectId: string;
  status: "pending" | "running" | "succeeded" | "failed" | "cancelled";
  method: string;
  resolvedUrl: string;
  requestSnapshot: Record<string, unknown>;
  error: { code: string; message: string } | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  response: {
    statusCode: number | null;
    statusText: string | null;
    durationMs: number | null;
    sizeBytes: number | null;
    headers: ResponseHeader[];
    cookies: ResponseCookie[];
    redirects: RedirectHop[];
    bodyPreview: string | null;
    bodyTruncated: boolean;
    contentType: string | null;
  } | null;
}

export type RequestActionResult<T = undefined> =
  { ok: true; data: T } | { ok: false; error: string };

export class RequestDomainError extends Error {
  constructor(
    message: string,
    public readonly code = "REQUEST_INVALID",
  ) {
    super(message);
    this.name = "RequestDomainError";
  }
}

export function parseRequestSettings(value: unknown): RequestSettings {
  return requestSettingsSchema.parse(value ?? {});
}

export function createRequestCopyName(
  originalName: string,
  existingNames: readonly string[],
) {
  const names = new Set(existingNames.map((name) => name.toLocaleLowerCase()));
  const base = `${originalName} copy`;
  if (!names.has(base.toLocaleLowerCase())) return base;

  let suffix = 2;
  while (names.has(`${base} ${suffix}`.toLocaleLowerCase())) suffix += 1;
  return `${base} ${suffix}`;
}
