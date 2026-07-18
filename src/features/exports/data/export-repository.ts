import "server-only";

import { randomUUID } from "node:crypto";

import { eq, getTableColumns } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

import { getDatabase } from "@/db/client";
import {
  applicationSettings,
  assertions,
  authProfileOverrides,
  authProfiles,
  authTokenCache,
  environments,
  folders,
  importedDefinitions,
  importedOperations,
  importRuns,
  projects,
  requestBodies,
  requestExecutions,
  requestHeaders,
  requestOutputDefinitions,
  requestQueryParameters,
  responseMetadata,
  runtimeOutputs,
  savedRequests,
  variables,
  workflowRuns,
  workflows,
  workflowStepRuns,
  workflowSteps,
  workspaces,
} from "@/db/schema";
import {
  type ArchiveData,
  type ArchiveRow,
  type ArchiveTables,
  emptyArchiveTables,
  EXPORT_SCHEMA_VERSION,
  ExportDomainError,
  type ExportKind,
  type ExportManifest,
  exportTableNames,
} from "@/features/exports/domain";
import { createCopyName } from "@/features/workspaces/domain";

type Database = ReturnType<typeof getDatabase>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const tableRegistry = {
  workspaces,
  projects,
  folders,
  environments,
  variables,
  authProfiles,
  authTokenCache,
  authProfileOverrides,
  savedRequests,
  requestHeaders,
  requestQueryParameters,
  requestBodies,
  requestOutputDefinitions,
  importedDefinitions,
  importedOperations,
  importRuns,
  requestExecutions,
  responseMetadata,
  runtimeOutputs,
  workflows,
  workflowSteps,
  assertions,
  workflowRuns,
  workflowStepRuns,
  applicationSettings,
} satisfies Record<(typeof exportTableNames)[number], PgTable>;

function rows(value: unknown[]): ArchiveRow[] {
  return value as ArchiveRow[];
}

export async function readAllArchiveTables(): Promise<ArchiveTables> {
  const database = getDatabase();
  const values = await Promise.all(
    exportTableNames.map((name) => database.select().from(tableRegistry[name])),
  );
  return Object.fromEntries(
    exportTableNames.map((name, index) => [name, rows(values[index] ?? [])]),
  ) as unknown as ArchiveTables;
}

function valueId(row: ArchiveRow, key: string) {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function filterByIds(
  source: ArchiveRow[],
  key: string,
  ids: ReadonlySet<string>,
) {
  return source.filter((row) => {
    const value = valueId(row, key);
    return value ? ids.has(value) : false;
  });
}

export async function collectExportScope(kind: ExportKind, id: string | null) {
  const all = await readAllArchiveTables();
  if (kind === "full") {
    return {
      tables: all,
      scope: { id: null, name: "full-backup" },
    };
  }
  if (!id) throw new ExportDomainError("An export scope is required.");

  const result = emptyArchiveTables();
  const workspace = all.workspaces.find((row) => row.id === id);
  const project = all.projects.find((row) => row.id === id);
  if (kind === "workspace" && !workspace) {
    throw new ExportDomainError("Workspace not found.", "EXPORT_NOT_FOUND");
  }
  if (kind === "project" && !project) {
    throw new ExportDomainError("Project not found.", "EXPORT_NOT_FOUND");
  }

  if (workspace) result.workspaces = [workspace];
  result.projects =
    kind === "workspace"
      ? all.projects.filter((row) => row.workspaceId === id)
      : [project as ArchiveRow];
  const projectIds = new Set(result.projects.map((row) => row.id));
  result.folders = filterByIds(all.folders, "projectId", projectIds);
  const folderIds = new Set(result.folders.map((row) => row.id));
  result.savedRequests = filterByIds(
    all.savedRequests,
    "projectId",
    projectIds,
  );
  const requestIds = new Set(result.savedRequests.map((row) => row.id));
  result.environments = all.environments.filter((row) =>
    kind === "workspace"
      ? row.workspaceId === id
      : valueId(row, "projectId") === id,
  );
  const environmentIds = new Set(result.environments.map((row) => row.id));
  result.variables = all.variables.filter((row) => {
    if (kind === "workspace" && row.workspaceId === id) return true;
    const projectId = valueId(row, "projectId");
    const environmentId = valueId(row, "environmentId");
    const requestId = valueId(row, "requestId");
    return Boolean(
      (projectId && projectIds.has(projectId)) ||
      (environmentId && environmentIds.has(environmentId)) ||
      (requestId && requestIds.has(requestId)),
    );
  });

  const directlyReferencedProfiles = new Set(
    result.savedRequests
      .map((row) => valueId(row, "authProfileId"))
      .filter((value): value is string => Boolean(value)),
  );
  result.authProfiles = all.authProfiles.filter((row) => {
    if (directlyReferencedProfiles.has(row.id)) return true;
    if (kind === "workspace" && row.workspaceId === id) return true;
    const projectId = valueId(row, "projectId");
    return projectId ? projectIds.has(projectId) : false;
  });
  const authProfileIds = new Set(result.authProfiles.map((row) => row.id));
  result.authTokenCache = all.authTokenCache.filter((row) => {
    const profileId = valueId(row, "authProfileId");
    const projectId = valueId(row, "projectId");
    return Boolean(
      profileId &&
      authProfileIds.has(profileId) &&
      projectId &&
      projectIds.has(projectId),
    );
  });
  result.authProfileOverrides = all.authProfileOverrides.filter((row) => {
    const profileId = valueId(row, "authProfileId");
    const projectId = valueId(row, "projectId");
    return Boolean(
      profileId &&
      authProfileIds.has(profileId) &&
      projectId &&
      projectIds.has(projectId),
    );
  });

  for (const table of [
    "requestHeaders",
    "requestQueryParameters",
    "requestBodies",
    "requestOutputDefinitions",
  ] as const) {
    result[table] = filterByIds(all[table], "requestId", requestIds);
  }
  const outputDefinitionIds = new Set(
    result.requestOutputDefinitions.map((row) => row.id),
  );
  result.importedDefinitions = filterByIds(
    all.importedDefinitions,
    "projectId",
    projectIds,
  );
  const definitionIds = new Set(
    result.importedDefinitions.map((row) => row.id),
  );
  result.importedOperations = filterByIds(
    all.importedOperations,
    "definitionId",
    definitionIds,
  );
  result.importRuns = filterByIds(all.importRuns, "projectId", projectIds);
  result.requestExecutions = filterByIds(
    all.requestExecutions,
    "projectId",
    projectIds,
  );
  const executionIds = new Set(result.requestExecutions.map((row) => row.id));
  result.responseMetadata = filterByIds(
    all.responseMetadata,
    "executionId",
    executionIds,
  );
  result.runtimeOutputs = all.runtimeOutputs.filter((row) => {
    const definitionId = valueId(row, "definitionId");
    const executionId = valueId(row, "executionId");
    return Boolean(
      definitionId &&
      outputDefinitionIds.has(definitionId) &&
      executionId &&
      executionIds.has(executionId),
    );
  });
  result.workflows = filterByIds(all.workflows, "projectId", projectIds);
  const workflowIds = new Set(result.workflows.map((row) => row.id));
  result.workflowSteps = filterByIds(
    all.workflowSteps,
    "workflowId",
    workflowIds,
  );
  const workflowStepIds = new Set(result.workflowSteps.map((row) => row.id));
  result.assertions = all.assertions.filter((row) => {
    const requestId = valueId(row, "requestId");
    const workflowStepId = valueId(row, "workflowStepId");
    return Boolean(
      (requestId && requestIds.has(requestId)) ||
      (workflowStepId && workflowStepIds.has(workflowStepId)),
    );
  });
  result.workflowRuns = filterByIds(all.workflowRuns, "projectId", projectIds);
  const workflowRunIds = new Set(result.workflowRuns.map((row) => row.id));
  result.workflowStepRuns = filterByIds(
    all.workflowStepRuns,
    "workflowRunId",
    workflowRunIds,
  );

  if (
    result.folders.some(
      (row) =>
        valueId(row, "projectId") && !projectIds.has(row.projectId as string),
    ) ||
    result.savedRequests.some(
      (row) =>
        valueId(row, "folderId") && !folderIds.has(row.folderId as string),
    )
  ) {
    throw new ExportDomainError("The export scope is inconsistent.");
  }

  const scopeRow = kind === "workspace" ? workspace : project;
  return {
    tables: result,
    scope: { id, name: String(scopeRow?.name ?? kind) },
  };
}

const dateColumns = new Set([
  "createdAt",
  "updatedAt",
  "importedAt",
  "expiresAt",
  "startedAt",
  "completedAt",
]);

function normaliseArchiveTables(input: ArchiveTables): ArchiveTables {
  const output = emptyArchiveTables();
  for (const name of exportTableNames) {
    const allowed = new Set(Object.keys(getTableColumns(tableRegistry[name])));
    const ids = new Set<string>();
    output[name] = input[name].map((row) => {
      if (ids.has(row.id)) {
        throw new ExportDomainError(`Duplicate ID in ${name}.`);
      }
      ids.add(row.id);
      const clean: ArchiveRow = { id: row.id };
      for (const [key, value] of Object.entries(row)) {
        if (!allowed.has(key)) continue;
        if (dateColumns.has(key) && typeof value === "string") {
          const date = new Date(value);
          if (Number.isNaN(date.valueOf())) {
            throw new ExportDomainError(`Invalid date in ${name}.${key}.`);
          }
          clean[key] = date;
        } else {
          clean[key] = value;
        }
      }
      return clean;
    });
  }
  return output;
}

function idMaps(tables: ArchiveTables) {
  return Object.fromEntries(
    exportTableNames.map((name) => [
      name,
      new Map(tables[name].map((row) => [row.id, randomUUID()])),
    ]),
  ) as Record<(typeof exportTableNames)[number], Map<string, string>>;
}

function remapValue(
  row: ArchiveRow,
  key: string,
  map: ReadonlyMap<string, string>,
  options: { nullable?: boolean } = {},
) {
  const value = row[key];
  if (value === null || value === undefined) return;
  if (typeof value !== "string") {
    throw new ExportDomainError(`Invalid relationship value: ${key}.`);
  }
  const remapped = map.get(value);
  if (!remapped) {
    if (options.nullable) row[key] = null;
    else throw new ExportDomainError(`Missing relationship for ${key}.`);
  } else {
    row[key] = remapped;
  }
}

function remapRequestSettings(
  row: ArchiveRow,
  environmentMap: ReadonlyMap<string, string>,
) {
  if (
    row.settings === null ||
    typeof row.settings !== "object" ||
    Array.isArray(row.settings)
  )
    return;
  const settings = row.settings as Record<string, unknown>;
  for (const key of [
    "workspaceEnvironmentId",
    "projectEnvironmentId",
    "selectedWorkspaceEnvironmentId",
    "selectedProjectEnvironmentId",
  ]) {
    const value = settings[key];
    if (typeof value === "string")
      settings[key] = environmentMap.get(value) ?? null;
  }
}

function remapScopedTables(
  input: ArchiveTables,
  kind: "workspace" | "project",
  targetWorkspaceId: string | null,
  importedName: string,
) {
  const tables = structuredClone(input);
  const maps = idMaps(tables);
  const sourceWorkspaceId = valueId(
    tables.projects[0] as ArchiveRow,
    "workspaceId",
  );

  for (const name of exportTableNames) {
    for (const row of tables[name]) row.id = maps[name].get(row.id) as string;
  }

  for (const row of tables.workspaces) {
    row.name = importedName;
  }
  for (const row of tables.projects) {
    row.workspaceId =
      kind === "workspace"
        ? maps.workspaces.get(String(row.workspaceId))
        : targetWorkspaceId;
    if (kind === "project") row.name = importedName;
  }
  for (const row of tables.folders) {
    remapValue(row, "projectId", maps.projects);
    remapValue(row, "parentId", maps.folders, { nullable: true });
  }
  for (const row of tables.environments) {
    row.workspaceId =
      kind === "workspace"
        ? maps.workspaces.get(String(row.workspaceId))
        : targetWorkspaceId;
    remapValue(row, "projectId", maps.projects, { nullable: true });
  }
  for (const row of tables.savedRequests) {
    remapValue(row, "projectId", maps.projects);
    remapValue(row, "folderId", maps.folders, { nullable: true });
    remapValue(row, "authProfileId", maps.authProfiles, { nullable: true });
    remapRequestSettings(row, maps.environments);
  }
  for (const row of tables.variables) {
    if (typeof row.workspaceId === "string") {
      row.workspaceId =
        kind === "workspace"
          ? (maps.workspaces.get(row.workspaceId) ?? null)
          : targetWorkspaceId;
    }
    remapValue(row, "projectId", maps.projects, { nullable: true });
    remapValue(row, "environmentId", maps.environments, { nullable: true });
    remapValue(row, "requestId", maps.savedRequests, { nullable: true });
  }
  for (const row of tables.authProfiles) {
    if (kind === "project" && row.workspaceId === sourceWorkspaceId) {
      row.workspaceId = null;
      row.projectId = maps.projects.values().next().value ?? null;
    } else {
      remapValue(row, "workspaceId", maps.workspaces, { nullable: true });
      remapValue(row, "projectId", maps.projects, { nullable: true });
    }
    remapValue(row, "tokenRequestId", maps.savedRequests, { nullable: true });
  }
  if (kind === "project") {
    const usedProfileNames: string[] = [];
    for (const row of tables.authProfiles) {
      const name = String(row.name ?? "Authentication profile");
      row.name = usedProfileNames.some(
        (existing) => existing.toLocaleLowerCase() === name.toLocaleLowerCase(),
      )
        ? createCopyName(name, usedProfileNames)
        : name;
      usedProfileNames.push(String(row.name));
    }
  }
  for (const row of tables.authTokenCache) {
    remapValue(row, "authProfileId", maps.authProfiles);
    remapValue(row, "projectId", maps.projects);
  }
  for (const row of tables.authProfileOverrides) {
    remapValue(row, "authProfileId", maps.authProfiles);
    remapValue(row, "projectId", maps.projects);
  }
  for (const name of [
    "requestHeaders",
    "requestQueryParameters",
    "requestBodies",
    "requestOutputDefinitions",
  ] as const) {
    for (const row of tables[name]) {
      remapValue(row, "requestId", maps.savedRequests);
    }
  }
  for (const row of tables.importedDefinitions) {
    remapValue(row, "projectId", maps.projects);
  }
  for (const row of tables.importedOperations) {
    remapValue(row, "definitionId", maps.importedDefinitions);
    remapValue(row, "requestId", maps.savedRequests, { nullable: true });
  }
  for (const row of tables.importRuns) {
    remapValue(row, "definitionId", maps.importedDefinitions, {
      nullable: true,
    });
    remapValue(row, "projectId", maps.projects);
  }
  for (const row of tables.requestExecutions) {
    remapValue(row, "projectId", maps.projects);
    remapValue(row, "requestId", maps.savedRequests, { nullable: true });
  }
  for (const row of tables.responseMetadata) {
    remapValue(row, "executionId", maps.requestExecutions);
  }
  for (const row of tables.runtimeOutputs) {
    remapValue(row, "definitionId", maps.requestOutputDefinitions);
    remapValue(row, "executionId", maps.requestExecutions);
  }
  for (const row of tables.workflows) {
    remapValue(row, "projectId", maps.projects);
  }
  for (const row of tables.workflowSteps) {
    remapValue(row, "workflowId", maps.workflows);
    remapValue(row, "requestId", maps.savedRequests);
  }
  for (const row of tables.assertions) {
    remapValue(row, "requestId", maps.savedRequests, { nullable: true });
    remapValue(row, "workflowStepId", maps.workflowSteps, { nullable: true });
  }
  for (const row of tables.workflowRuns) {
    remapValue(row, "workflowId", maps.workflows, { nullable: true });
    remapValue(row, "projectId", maps.projects);
  }
  for (const row of tables.workflowStepRuns) {
    remapValue(row, "workflowRunId", maps.workflowRuns);
    remapValue(row, "workflowStepId", maps.workflowSteps, { nullable: true });
    remapValue(row, "requestId", maps.savedRequests, { nullable: true });
    remapValue(row, "requestExecutionId", maps.requestExecutions, {
      nullable: true,
    });
  }
  tables.applicationSettings = [];
  return tables;
}

async function insertRows<TTable extends PgTable>(
  transaction: Transaction,
  table: TTable,
  values: TTable["$inferInsert"][],
) {
  for (let offset = 0; offset < values.length; offset += 250) {
    await transaction.insert(table).values(values.slice(offset, offset + 250));
  }
}

async function insertFolders(transaction: Transaction, tables: ArchiveTables) {
  const pending = [...tables.folders];
  const inserted = new Set<string>();
  while (pending.length) {
    const ready = pending.filter((row) => {
      const parentId = valueId(row, "parentId");
      return !parentId || inserted.has(parentId);
    });
    if (!ready.length)
      throw new ExportDomainError("Folder hierarchy is invalid.");
    await insertRows(
      transaction,
      folders,
      ready as (typeof folders.$inferInsert)[],
    );
    ready.forEach((row) => inserted.add(row.id));
    const readyIds = new Set(ready.map((row) => row.id));
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      if (readyIds.has(pending[index]?.id ?? "")) pending.splice(index, 1);
    }
  }
}

async function insertArchiveTables(
  transaction: Transaction,
  tables: ArchiveTables,
) {
  await insertRows(
    transaction,
    workspaces,
    tables.workspaces as (typeof workspaces.$inferInsert)[],
  );
  await insertRows(
    transaction,
    projects,
    tables.projects as (typeof projects.$inferInsert)[],
  );
  await insertFolders(transaction, tables);
  await insertRows(
    transaction,
    environments,
    tables.environments as (typeof environments.$inferInsert)[],
  );
  await insertRows(
    transaction,
    savedRequests,
    tables.savedRequests as (typeof savedRequests.$inferInsert)[],
  );
  await insertRows(
    transaction,
    variables,
    tables.variables as (typeof variables.$inferInsert)[],
  );
  for (const [table, values] of [
    [requestHeaders, tables.requestHeaders],
    [requestQueryParameters, tables.requestQueryParameters],
    [requestBodies, tables.requestBodies],
    [requestOutputDefinitions, tables.requestOutputDefinitions],
  ] as const) {
    await insertRows(transaction, table, values as never[]);
  }
  await insertRows(
    transaction,
    authProfiles,
    tables.authProfiles as (typeof authProfiles.$inferInsert)[],
  );
  await insertRows(
    transaction,
    authProfileOverrides,
    tables.authProfileOverrides as (typeof authProfileOverrides.$inferInsert)[],
  );
  await insertRows(
    transaction,
    authTokenCache,
    tables.authTokenCache as (typeof authTokenCache.$inferInsert)[],
  );
  await insertRows(
    transaction,
    importedDefinitions,
    tables.importedDefinitions as (typeof importedDefinitions.$inferInsert)[],
  );
  await insertRows(
    transaction,
    importedOperations,
    tables.importedOperations as (typeof importedOperations.$inferInsert)[],
  );
  await insertRows(
    transaction,
    importRuns,
    tables.importRuns as (typeof importRuns.$inferInsert)[],
  );
  await insertRows(
    transaction,
    requestExecutions,
    tables.requestExecutions as (typeof requestExecutions.$inferInsert)[],
  );
  await insertRows(
    transaction,
    responseMetadata,
    tables.responseMetadata as (typeof responseMetadata.$inferInsert)[],
  );
  await insertRows(
    transaction,
    runtimeOutputs,
    tables.runtimeOutputs as (typeof runtimeOutputs.$inferInsert)[],
  );
  await insertRows(
    transaction,
    workflows,
    tables.workflows as (typeof workflows.$inferInsert)[],
  );
  await insertRows(
    transaction,
    workflowSteps,
    tables.workflowSteps as (typeof workflowSteps.$inferInsert)[],
  );
  await insertRows(
    transaction,
    assertions,
    tables.assertions as (typeof assertions.$inferInsert)[],
  );
  await insertRows(
    transaction,
    workflowRuns,
    tables.workflowRuns as (typeof workflowRuns.$inferInsert)[],
  );
  await insertRows(
    transaction,
    workflowStepRuns,
    tables.workflowStepRuns as (typeof workflowStepRuns.$inferInsert)[],
  );
  await insertRows(
    transaction,
    applicationSettings,
    tables.applicationSettings as (typeof applicationSettings.$inferInsert)[],
  );
}

function totalRecords(tables: ArchiveTables) {
  return exportTableNames.reduce(
    (total, name) => total + tables[name].length,
    0,
  );
}

async function uniqueImportName(
  kind: "workspace" | "project",
  original: string,
  targetWorkspaceId: string | null,
) {
  if (kind === "workspace") {
    const existing = await getDatabase()
      .select({ name: workspaces.name })
      .from(workspaces);
    return createCopyName(
      original,
      existing.map(({ name }) => name),
    );
  }
  if (!targetWorkspaceId) {
    throw new ExportDomainError("Choose a destination workspace.");
  }
  const existing = await getDatabase()
    .select({ name: projects.name })
    .from(projects)
    .where(eq(projects.workspaceId, targetWorkspaceId));
  return createCopyName(
    original,
    existing.map(({ name }) => name),
  );
}

export async function restoreExportArchive(input: {
  manifest: ExportManifest;
  data: ArchiveData;
  targetWorkspaceId: string | null;
}) {
  if (input.manifest.schemaVersion !== EXPORT_SCHEMA_VERSION) {
    throw new ExportDomainError(
      `Unsupported database schema version: ${input.manifest.schemaVersion}.`,
      "EXPORT_VERSION_UNSUPPORTED",
    );
  }
  const normalised = normaliseArchiveTables(input.data.tables as ArchiveTables);
  const restoredAt = new Date().toISOString();

  if (input.manifest.kind === "full") {
    await getDatabase().transaction(async (transaction) => {
      await transaction.delete(applicationSettings);
      await transaction.delete(workflows);
      await transaction.delete(workspaces);
      await insertArchiveTables(transaction, normalised);
      await transaction
        .insert(applicationSettings)
        .values({
          key: "backup.lastRestore",
          value: {
            kind: "full",
            sourceCreatedAt: input.manifest.createdAt,
            restoredAt,
            recordCount: totalRecords(normalised),
          },
        })
        .onConflictDoUpdate({
          target: applicationSettings.key,
          set: {
            value: {
              kind: "full",
              sourceCreatedAt: input.manifest.createdAt,
              restoredAt,
              recordCount: totalRecords(normalised),
            },
            updatedAt: new Date(),
          },
        });
    });
    return {
      kind: "full" as const,
      name: "Full backup",
      recordCount: totalRecords(normalised),
    };
  }

  const sourceRows =
    input.manifest.kind === "workspace"
      ? normalised.workspaces
      : normalised.projects;
  if (
    sourceRows.length !== 1 ||
    sourceRows[0]?.id !== input.manifest.scope.id
  ) {
    throw new ExportDomainError(
      "The archive scope does not match its manifest.",
    );
  }
  if (input.manifest.kind === "project") {
    if (!input.targetWorkspaceId) {
      throw new ExportDomainError("Choose a destination workspace.");
    }
    const [target] = await getDatabase()
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, input.targetWorkspaceId))
      .limit(1);
    if (!target)
      throw new ExportDomainError("Destination workspace not found.");
  }
  const name = await uniqueImportName(
    input.manifest.kind,
    String(sourceRows[0]?.name ?? input.manifest.scope.name),
    input.targetWorkspaceId,
  );
  const remapped = remapScopedTables(
    normalised,
    input.manifest.kind,
    input.targetWorkspaceId,
    name,
  );
  await getDatabase().transaction(async (transaction) => {
    await insertArchiveTables(transaction, remapped);
  });
  return {
    kind: input.manifest.kind,
    name,
    recordCount: totalRecords(remapped),
  };
}
