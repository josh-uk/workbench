import { z } from "zod";

import type { AuthType } from "@/features/authentication/domain";
import {
  httpMethodSchema,
  requestBodySchema,
  requestFieldSchema,
  requestSettingsSchema,
} from "@/features/requests/domain";
import { entityIdSchema, entityNameSchema } from "@/features/workspaces/domain";

export const MAX_COLLECTION_IMPORT_BYTES = 2 * 1_024 * 1_024;
export const MAX_COLLECTION_REQUESTS = 2_000;

export const collectionImportFormatSchema = z.enum([
  "auto",
  "httpie",
  "postman",
  "curl",
  "raw_http",
]);
export type CollectionImportFormat = Exclude<
  z.infer<typeof collectionImportFormatSchema>,
  "auto"
>;

export const collectionImportSourceSchema = z.object({
  sourceType: z.enum(["paste", "file"]),
  content: z
    .string()
    .min(1, "Paste or choose an import source.")
    .max(
      MAX_COLLECTION_IMPORT_BYTES,
      "Import sources must be 2 MiB or smaller.",
    ),
  format: collectionImportFormatSchema.default("auto"),
});

export const previewCollectionImportSchema = z.object({
  projectId: entityIdSchema,
  source: collectionImportSourceSchema,
});

export const collectionConflictStrategySchema = z.enum([
  "replace",
  "merge",
  "rename",
  "skip",
]);
export type CollectionConflictStrategy = z.infer<
  typeof collectionConflictStrategySchema
>;

export const executeCollectionImportSchema = z.object({
  projectId: entityIdSchema,
  previewSourceHash: z
    .string()
    .regex(/^[a-f\d]{64}$/i, "The import preview hash is invalid."),
  source: collectionImportSourceSchema,
  options: z.object({
    definitionName: entityNameSchema,
    selectedRequestKeys: z
      .array(z.string().min(1).max(8_192))
      .max(MAX_COLLECTION_REQUESTS),
    includeEnvironments: z.boolean().default(true),
    includeProjectVariables: z.boolean().default(true),
    includeAuthProfiles: z.boolean().default(true),
    allowPrivateNetwork: z.boolean().default(false),
    conflictStrategy: collectionConflictStrategySchema.default("rename"),
  }),
});

export interface PortableImportAuthProfile {
  sourceKey: string;
  name: string;
  type: AuthType;
  configuration: Record<string, string>;
}

export interface PortableImportVariable {
  name: string;
  value: string;
  secret: boolean;
  enabled: boolean;
}

export interface PortableImportEnvironment {
  sourceKey: string;
  name: string;
  variables: PortableImportVariable[];
  sourceMetadata: Record<string, unknown>;
}

export interface PortableImportRequest {
  sourceKey: string;
  name: string;
  description: string;
  folderPath: string[];
  method: z.infer<typeof httpMethodSchema>;
  url: string;
  queryParameters: Array<z.infer<typeof requestFieldSchema>>;
  headers: Array<z.infer<typeof requestFieldSchema>>;
  requestVariables: PortableImportVariable[];
  body: z.infer<typeof requestBodySchema>;
  settings: z.infer<typeof requestSettingsSchema>;
  authProfileKey: string | null;
  sourceMetadata: Record<string, unknown>;
}

export interface PortableImportPlan {
  format: CollectionImportFormat;
  formatVersion: string | null;
  name: string;
  sourceHash: string;
  requests: PortableImportRequest[];
  environments: PortableImportEnvironment[];
  projectVariables: PortableImportVariable[];
  authProfiles: PortableImportAuthProfile[];
  unsupported: string[];
  warnings: string[];
}

export interface CollectionImportConflict {
  key: string;
  kind: "request" | "folder" | "environment" | "variable" | "auth_profile";
  label: string;
  details: string;
}

export interface CollectionImportPreview extends PortableImportPlan {
  target: {
    workspaceId: string;
    workspaceName: string;
    projectId: string;
    projectName: string;
  };
  conflicts: CollectionImportConflict[];
}

export interface CollectionImportResult {
  definitionId: string;
  createdFolders: number;
  createdRequests: number;
  replacedRequests: number;
  mergedRequests: number;
  skippedRequests: number;
  createdEnvironments: number;
  createdVariables: number;
  createdAuthProfiles: number;
  warnings: string[];
}

export interface CollectionImportSummary {
  id: string;
  projectId: string;
  name: string;
  format: CollectionImportFormat;
  sourceType: "paste" | "file";
  requestCount: number;
  linkedRequestCount: number;
  importedAt: string;
}

export type CollectionImportActionResult<T> =
  { ok: true; data: T } | { ok: false; error: string };

export class CollectionImportError extends Error {
  constructor(
    message: string,
    public readonly code = "COLLECTION_IMPORT_INVALID",
  ) {
    super(message);
    this.name = "CollectionImportError";
  }
}
