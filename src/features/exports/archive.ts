import { createHash } from "node:crypto";

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { z } from "zod";

import packageMetadata from "../../../package.json";

import { authSecretFields } from "@/features/authentication/domain";
import {
  archiveDataSchema,
  type ArchiveData,
  type ArchiveRow,
  type ArchiveTables,
  EXPORT_FORMAT,
  EXPORT_SCHEMA_VERSION,
  EXPORT_VERSION,
  ExportDomainError,
  type ExportKind,
  exportManifestSchema,
  type ExportManifest,
  type ExportSecretMode,
  exportTableNames,
  MAX_EXPORT_ARCHIVE_BYTES,
  MAX_EXPORT_FILE_BYTES,
  MAX_EXPORT_TOTAL_BYTES,
} from "@/features/exports/domain";
import {
  decryptExportPayload,
  encryptExportPayload,
} from "@/features/exports/crypto";

const encoder = new TextEncoder();
const secretReferenceSchema = z
  .object({
    table: z.enum(exportTableNames),
    id: z.uuid(),
    path: z.array(z.union([z.string().max(120), z.number().int().min(0)])),
    value: z.unknown(),
  })
  .strict();
const secretBundleSchema = z
  .object({
    version: z.literal(1),
    values: z.array(secretReferenceSchema).max(500_000),
  })
  .strict();

type SecretReference = z.infer<typeof secretReferenceSchema>;
const sensitiveHeaderName =
  /authorization|proxy-authorization|api[-_]?key|token|secret|password|cookie/i;
const sensitiveQueryName =
  /api[-_]?key|token|secret|password|signature|credential/i;

function checksum(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function cloneTables(tables: ArchiveTables): ArchiveTables {
  return structuredClone(tables);
}

function hideValue(value: unknown) {
  if (Array.isArray(value)) return [];
  if (value !== null && typeof value === "object") return {};
  if (typeof value === "string") return "";
  return null;
}

function extractSecret(
  values: SecretReference[],
  table: SecretReference["table"],
  row: ArchiveRow,
  path: Array<string | number>,
  owner: Record<string, unknown> | unknown[],
  key: string | number,
  replacement?: unknown,
) {
  const value = owner[key as keyof typeof owner];
  if (value === undefined || value === null || value === "") return;
  values.push({ table, id: row.id, path, value });
  Object.assign(owner, {
    [key]: replacement === undefined ? hideValue(value) : replacement,
  });
}

function extractConfigurationSecrets(
  values: SecretReference[],
  table: "authProfiles" | "authProfileOverrides",
  row: ArchiveRow,
) {
  if (
    row.configuration === null ||
    typeof row.configuration !== "object" ||
    Array.isArray(row.configuration)
  )
    return;
  const configuration = row.configuration as Record<string, unknown>;
  for (const key of authSecretFields) {
    if (key in configuration) {
      extractSecret(
        values,
        table,
        row,
        ["configuration", key],
        configuration,
        key,
      );
    }
  }
}

function extractRuntimeOverrideSecrets(
  values: SecretReference[],
  row: ArchiveRow,
) {
  if (!Array.isArray(row.runtimeOverrides)) return;
  row.runtimeOverrides.forEach((override, index) => {
    if (
      override &&
      typeof override === "object" &&
      "secret" in override &&
      override.secret === true &&
      "value" in override
    ) {
      extractSecret(
        values,
        "workflowSteps",
        row,
        ["runtimeOverrides", index, "value"],
        override as Record<string, unknown>,
        "value",
      );
    }
  });
}

export function sanitiseArchiveTables(tables: ArchiveTables) {
  const sanitised = cloneTables(tables);
  const values: SecretReference[] = [];

  for (const row of sanitised.variables) {
    if (row.secret === true)
      extractSecret(values, "variables", row, ["value"], row, "value");
  }
  for (const row of sanitised.requestHeaders) {
    if (
      row.secret === true ||
      (typeof row.name === "string" && sensitiveHeaderName.test(row.name))
    )
      extractSecret(values, "requestHeaders", row, ["value"], row, "value");
  }
  for (const row of sanitised.requestQueryParameters) {
    if (typeof row.name === "string" && sensitiveQueryName.test(row.name)) {
      extractSecret(
        values,
        "requestQueryParameters",
        row,
        ["value"],
        row,
        "value",
      );
    }
  }
  for (const row of sanitised.requestBodies) {
    extractSecret(values, "requestBodies", row, ["content"], row, "content");
  }
  for (const row of sanitised.savedRequests) {
    if (typeof row.url === "string") {
      const redactedUrl = row.url.replace(
        /([?&][^=&#]*(?:api[-_]?key|token|secret|password|signature|credential)[^=&#]*=)[^&#]*/gi,
        "$1",
      );
      if (redactedUrl !== row.url) {
        extractSecret(
          values,
          "savedRequests",
          row,
          ["url"],
          row,
          "url",
          redactedUrl,
        );
      }
    }
    if (
      row.settings &&
      typeof row.settings === "object" &&
      !Array.isArray(row.settings) &&
      Array.isArray((row.settings as Record<string, unknown>).cookies)
    ) {
      const cookies = (row.settings as { cookies: unknown[] }).cookies;
      cookies.forEach((cookie, index) => {
        if (cookie && typeof cookie === "object" && "value" in cookie) {
          extractSecret(
            values,
            "savedRequests",
            row,
            ["settings", "cookies", index, "value"],
            cookie as Record<string, unknown>,
            "value",
          );
        }
      });
    }
  }
  for (const row of sanitised.authProfiles) {
    extractConfigurationSecrets(values, "authProfiles", row);
  }
  for (const row of sanitised.authProfileOverrides) {
    extractConfigurationSecrets(values, "authProfileOverrides", row);
  }
  for (const row of sanitised.authTokenCache) {
    extractSecret(
      values,
      "authTokenCache",
      row,
      ["accessToken"],
      row,
      "accessToken",
    );
    extractSecret(
      values,
      "authTokenCache",
      row,
      ["refreshToken"],
      row,
      "refreshToken",
    );
  }
  for (const row of sanitised.runtimeOutputs) {
    if (row.secret === true)
      extractSecret(values, "runtimeOutputs", row, ["value"], row, "value");
  }
  for (const row of sanitised.workflowSteps) {
    extractRuntimeOverrideSecrets(values, row);
  }
  for (const row of sanitised.importedDefinitions) {
    extractSecret(
      values,
      "importedDefinitions",
      row,
      ["originalDocument"],
      row,
      "originalDocument",
    );
    extractSecret(
      values,
      "importedDefinitions",
      row,
      ["sourceUrl"],
      row,
      "sourceUrl",
    );
    extractSecret(
      values,
      "importedDefinitions",
      row,
      ["metadata"],
      row,
      "metadata",
    );
  }
  for (const row of sanitised.importedOperations) {
    extractSecret(
      values,
      "importedOperations",
      row,
      ["operation"],
      row,
      "operation",
    );
  }
  for (const row of sanitised.importRuns) {
    extractSecret(
      values,
      "importRuns",
      row,
      ["sourceDocument"],
      row,
      "sourceDocument",
    );
    extractSecret(values, "importRuns", row, ["error"], row, "error");
    for (const field of ["summary", "warnings", "changes"] as const) {
      extractSecret(values, "importRuns", row, [field], row, field);
    }
  }
  for (const row of sanitised.requestExecutions) {
    extractSecret(
      values,
      "requestExecutions",
      row,
      ["requestSnapshot"],
      row,
      "requestSnapshot",
    );
    extractSecret(values, "requestExecutions", row, ["error"], row, "error");
  }
  for (const row of sanitised.responseMetadata) {
    for (const field of ["headers", "cookies", "bodyPreview"] as const) {
      extractSecret(values, "responseMetadata", row, [field], row, field);
    }
  }
  for (const row of sanitised.workflowRuns) {
    extractSecret(values, "workflowRuns", row, ["error"], row, "error");
  }
  for (const row of sanitised.workflowStepRuns) {
    extractSecret(values, "workflowStepRuns", row, ["error"], row, "error");
  }

  return { sanitised, secrets: { version: 1 as const, values } };
}

function recordCounts(tables: ArchiveTables) {
  return Object.fromEntries(
    exportTableNames.map((name) => [name, tables[name].length]),
  ) as Record<(typeof exportTableNames)[number], number>;
}

export async function createExportArchive(input: {
  tables: ArchiveTables;
  kind: ExportKind;
  scope: { id: string | null; name: string };
  secretMode: ExportSecretMode;
  password?: string;
  createdAt?: Date;
}) {
  const { sanitised, secrets } = sanitiseArchiveTables(input.tables);
  const data = encoder.encode(JSON.stringify({ tables: sanitised }));
  if (data.byteLength > MAX_EXPORT_FILE_BYTES) {
    throw new ExportDomainError("The logical export is too large.");
  }

  const files: Record<string, Uint8Array> = { "data.json": data };
  let secretsFile: "secrets.json" | "secrets.json.enc" | null = null;
  if (input.secretMode === "plaintext") {
    secretsFile = "secrets.json";
    files[secretsFile] = encoder.encode(JSON.stringify(secrets));
  } else if (input.secretMode === "encrypted") {
    if (!input.password || input.password.length < 12) {
      throw new ExportDomainError(
        "A password of at least 12 characters is required.",
      );
    }
    secretsFile = "secrets.json.enc";
    files[secretsFile] = await encryptExportPayload(
      encoder.encode(JSON.stringify(secrets)),
      input.password,
    );
  }

  const manifest: ExportManifest = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    schemaVersion: EXPORT_SCHEMA_VERSION,
    appVersion: packageMetadata.version,
    kind: input.kind,
    createdAt: (input.createdAt ?? new Date()).toISOString(),
    secretMode: input.secretMode,
    scope: input.scope,
    files: { data: "data.json", secrets: secretsFile },
    checksums: Object.fromEntries(
      Object.entries(files).map(([name, value]) => [name, checksum(value)]),
    ),
    recordCounts: recordCounts(sanitised),
    warning:
      input.secretMode === "plaintext"
        ? "This archive contains unencrypted secret values. Store and transmit it securely."
        : null,
  };
  exportManifestSchema.parse(manifest);
  files["manifest.json"] = encoder.encode(JSON.stringify(manifest, null, 2));
  const expandedBytes = Object.values(files).reduce((total, file) => {
    if (file.byteLength > MAX_EXPORT_FILE_BYTES) {
      throw new ExportDomainError("An export file is too large.");
    }
    return total + file.byteLength;
  }, 0);
  if (expandedBytes > MAX_EXPORT_TOTAL_BYTES) {
    throw new ExportDomainError("The expanded export is too large.");
  }
  const archive = zipSync(files, { level: 6 });
  if (archive.byteLength > MAX_EXPORT_ARCHIVE_BYTES) {
    throw new ExportDomainError("The compressed export is too large.");
  }
  return { archive: Buffer.from(archive), manifest };
}

function safeArchivePath(path: string) {
  return (
    path === "manifest.json" ||
    path === "data.json" ||
    path === "secrets.json" ||
    path === "secrets.json.enc"
  );
}

function parseJsonFile(value: Uint8Array, name: string) {
  try {
    return JSON.parse(strFromU8(value));
  } catch {
    throw new ExportDomainError(`${name} is not valid JSON.`);
  }
}

function applySecrets(tables: ArchiveTables, payload: unknown) {
  const bundle = secretBundleSchema.parse(payload);
  const rows = new Map<string, ArchiveRow>();
  for (const table of exportTableNames) {
    for (const row of tables[table]) rows.set(`${table}:${row.id}`, row);
  }
  for (const reference of bundle.values) {
    const row = rows.get(`${reference.table}:${reference.id}`);
    if (!row)
      throw new ExportDomainError("Secret payload references a missing row.");
    let owner: unknown = row;
    for (const segment of reference.path.slice(0, -1)) {
      if (
        owner === null ||
        typeof owner !== "object" ||
        !Object.hasOwn(owner, segment)
      ) {
        throw new ExportDomainError("Secret payload contains an invalid path.");
      }
      owner = (owner as Record<string | number, unknown>)[segment];
    }
    const key = reference.path.at(-1);
    if (
      key === undefined ||
      key === "__proto__" ||
      key === "constructor" ||
      key === "prototype" ||
      owner === null ||
      typeof owner !== "object" ||
      !Object.hasOwn(owner, key)
    ) {
      throw new ExportDomainError("Secret payload contains an invalid path.");
    }
    Object.assign(owner, { [key]: reference.value });
  }
}

export async function parseExportArchive(
  archive: Uint8Array,
  password?: string,
): Promise<{ manifest: ExportManifest; data: ArchiveData }> {
  if (!archive.byteLength || archive.byteLength > MAX_EXPORT_ARCHIVE_BYTES) {
    throw new ExportDomainError("The export archive is empty or too large.");
  }
  let totalBytes = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(archive, {
      filter(file) {
        if (!safeArchivePath(file.name)) {
          throw new ExportDomainError(
            `Archive path is not allowed: ${file.name}`,
          );
        }
        if (file.originalSize > MAX_EXPORT_FILE_BYTES) {
          throw new ExportDomainError("An archive file is too large.");
        }
        totalBytes += file.originalSize;
        if (totalBytes > MAX_EXPORT_TOTAL_BYTES) {
          throw new ExportDomainError("The expanded archive is too large.");
        }
        return true;
      },
    });
  } catch (error) {
    if (error instanceof ExportDomainError) throw error;
    throw new ExportDomainError(
      "The file is not a valid Workbench ZIP archive.",
    );
  }

  if (!files["manifest.json"] || !files["data.json"]) {
    throw new ExportDomainError(
      "The archive manifest or data file is missing.",
    );
  }
  const manifest = exportManifestSchema.parse(
    parseJsonFile(files["manifest.json"], "manifest.json"),
  );
  const declared = new Set([
    "manifest.json",
    manifest.files.data,
    ...(manifest.files.secrets ? [manifest.files.secrets] : []),
  ]);
  if (
    Object.keys(files).length !== declared.size ||
    Object.keys(files).some((name) => !declared.has(name))
  ) {
    throw new ExportDomainError("The archive contains undeclared files.");
  }
  for (const [name, expected] of Object.entries(manifest.checksums)) {
    const file = files[name];
    if (!file || checksum(file) !== expected) {
      throw new ExportDomainError(`Archive checksum failed for ${name}.`);
    }
  }
  const data = archiveDataSchema.parse(
    parseJsonFile(files[manifest.files.data], manifest.files.data),
  );
  for (const table of exportTableNames) {
    if (data.tables[table].length !== manifest.recordCounts[table]) {
      throw new ExportDomainError(`Record count failed for ${table}.`);
    }
  }

  if (manifest.files.secrets) {
    const secretFile = files[manifest.files.secrets];
    if (!secretFile)
      throw new ExportDomainError("The secret payload is missing.");
    const payload =
      manifest.secretMode === "encrypted"
        ? parseJsonFile(
            await decryptExportPayload(secretFile, password ?? ""),
            "decrypted secrets",
          )
        : parseJsonFile(secretFile, manifest.files.secrets);
    applySecrets(data.tables as ArchiveTables, payload);
  }
  return { manifest, data };
}

export function archiveFilename(manifest: ExportManifest) {
  const timestamp = manifest.createdAt.replaceAll(":", "-");
  const scope = manifest.scope.name
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `workbench-${manifest.kind}-${scope || "export"}-${timestamp}.zip`;
}

export function mutateZipJson(
  archive: Uint8Array,
  name: string,
  mutate: (value: Record<string, unknown>) => void,
) {
  const files = unzipSync(archive);
  const value = parseJsonFile(files[name] ?? strToU8("{}"), name) as Record<
    string,
    unknown
  >;
  mutate(value);
  files[name] = strToU8(JSON.stringify(value));
  return zipSync(files, { level: 6 });
}
