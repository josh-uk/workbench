import { z } from "zod";

import { entityIdSchema } from "@/features/workspaces/domain";

export const EXPORT_FORMAT = "workbench-export" as const;
export const EXPORT_VERSION = 1 as const;
export const EXPORT_SCHEMA_VERSION = "0003_fresh_tana_nile" as const;
export const MAX_EXPORT_ARCHIVE_BYTES = 32 * 1_024 * 1_024;
export const MAX_EXPORT_FILE_BYTES = 64 * 1_024 * 1_024;
export const MAX_EXPORT_TOTAL_BYTES = 96 * 1_024 * 1_024;
export const MAX_EXPORT_ROWS_PER_TABLE = 100_000;

export const exportKinds = ["workspace", "project", "full"] as const;
export const exportSecretModes = ["exclude", "encrypted", "plaintext"] as const;

export const exportTableNames = [
  "workspaces",
  "projects",
  "folders",
  "environments",
  "variables",
  "authProfiles",
  "authTokenCache",
  "authProfileOverrides",
  "savedRequests",
  "requestHeaders",
  "requestQueryParameters",
  "requestBodies",
  "requestOutputDefinitions",
  "importedDefinitions",
  "importedOperations",
  "importRuns",
  "requestExecutions",
  "responseMetadata",
  "runtimeOutputs",
  "workflows",
  "workflowSteps",
  "assertions",
  "workflowRuns",
  "workflowStepRuns",
  "applicationSettings",
] as const;

export type ExportKind = (typeof exportKinds)[number];
export type ExportSecretMode = (typeof exportSecretModes)[number];
export type ExportTableName = (typeof exportTableNames)[number];
export type ArchiveRow = Record<string, unknown> & { id: string };
export type ArchiveTables = Record<ExportTableName, ArchiveRow[]>;

const checksumSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Archive checksum is invalid.");

export const exportManifestSchema = z
  .object({
    format: z.literal(EXPORT_FORMAT),
    version: z.literal(EXPORT_VERSION),
    schemaVersion: z.string().min(1).max(120),
    appVersion: z.string().min(1).max(40),
    kind: z.enum(exportKinds),
    createdAt: z.iso.datetime({ offset: true }),
    secretMode: z.enum(exportSecretModes),
    scope: z
      .object({
        id: entityIdSchema.nullable(),
        name: z.string().min(1).max(120),
      })
      .strict(),
    files: z
      .object({
        data: z.literal("data.json"),
        secrets: z.enum(["secrets.json", "secrets.json.enc"]).nullable(),
      })
      .strict(),
    checksums: z.record(z.string(), checksumSchema),
    recordCounts: z.record(
      z.enum(exportTableNames),
      z.number().int().min(0).max(MAX_EXPORT_ROWS_PER_TABLE),
    ),
    warning: z.string().max(500).nullable(),
  })
  .strict()
  .superRefine((manifest, context) => {
    const expectedSecretsFile =
      manifest.secretMode === "exclude"
        ? null
        : manifest.secretMode === "encrypted"
          ? "secrets.json.enc"
          : "secrets.json";
    if (manifest.files.secrets !== expectedSecretsFile) {
      context.addIssue({
        code: "custom",
        path: ["files", "secrets"],
        message: "Secret mode and secret payload do not match.",
      });
    }
    const expectedFiles = manifest.files.secrets
      ? [manifest.files.data, manifest.files.secrets]
      : [manifest.files.data];
    if (
      Object.keys(manifest.checksums).length !== expectedFiles.length ||
      expectedFiles.some((file) => !(file in manifest.checksums))
    ) {
      context.addIssue({
        code: "custom",
        path: ["checksums"],
        message: "Archive checksums do not match the declared files.",
      });
    }
    if (manifest.secretMode === "plaintext" && !manifest.warning) {
      context.addIssue({
        code: "custom",
        path: ["warning"],
        message: "Plain-text secret exports require a warning.",
      });
    }
  });

const archiveRowSchema = z
  .record(z.string().max(120), z.unknown())
  .and(z.object({ id: entityIdSchema }));

export const archiveDataSchema = z
  .object({
    tables: z.record(
      z.enum(exportTableNames),
      z.array(archiveRowSchema).max(MAX_EXPORT_ROWS_PER_TABLE),
    ),
  })
  .strict();

export const createExportSchema = z
  .object({
    kind: z.enum(exportKinds),
    id: entityIdSchema.nullable().default(null),
    secretMode: z.enum(exportSecretModes).default("exclude"),
    password: z.string().min(12).max(512).optional(),
    confirmPlaintext: z.boolean().default(false),
  })
  .superRefine((value, context) => {
    if (value.kind !== "full" && !value.id) {
      context.addIssue({
        code: "custom",
        path: ["id"],
        message: "An export scope is required.",
      });
    }
    if (value.kind === "full" && value.id) {
      context.addIssue({
        code: "custom",
        path: ["id"],
        message: "A full backup cannot have a workspace or project ID.",
      });
    }
    if (value.secretMode === "encrypted" && !value.password) {
      context.addIssue({
        code: "custom",
        path: ["password"],
        message: "A password of at least 12 characters is required.",
      });
    }
    if (value.secretMode === "plaintext" && !value.confirmPlaintext) {
      context.addIssue({
        code: "custom",
        path: ["confirmPlaintext"],
        message: "Plain-text secret export must be explicitly confirmed.",
      });
    }
  });

export const importExportSchema = z.object({
  targetWorkspaceId: entityIdSchema.nullable().default(null),
  password: z.string().max(512).optional(),
});

export const backupFilenameSchema = z
  .string()
  .regex(
    /^workbench-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.zip$/,
    "Backup filename is invalid.",
  );

export const backupSettingsSchema = z
  .object({
    automatic: z.boolean().default(false),
    intervalHours: z.number().int().min(1).max(168).default(24),
    retentionCount: z.number().int().min(1).max(100).default(7),
    secretMode: z.enum(["exclude", "encrypted"]).default("exclude"),
    lastAttemptAt: z.iso.datetime({ offset: true }).nullable().default(null),
    lastSuccessAt: z.iso.datetime({ offset: true }).nullable().default(null),
    lastError: z.string().max(500).nullable().default(null),
  })
  .strict();

export const dataRetentionSettingsSchema = z
  .object({
    executionHistoryLimit: z.number().int().min(10).max(1_000).default(100),
  })
  .strict();

export type ExportManifest = z.infer<typeof exportManifestSchema>;
export type ArchiveData = z.infer<typeof archiveDataSchema>;
export type BackupSettings = z.infer<typeof backupSettingsSchema>;
export type DataRetentionSettings = z.infer<typeof dataRetentionSettingsSchema>;

export class ExportDomainError extends Error {
  constructor(
    message: string,
    public readonly code = "EXPORT_INVALID",
  ) {
    super(message);
    this.name = "ExportDomainError";
  }
}

export function emptyArchiveTables(): ArchiveTables {
  return Object.fromEntries(
    exportTableNames.map((name) => [name, []]),
  ) as unknown as ArchiveTables;
}
