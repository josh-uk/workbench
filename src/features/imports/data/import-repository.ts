import "server-only";

import { and, asc, eq, inArray, isNull, max, or, sql } from "drizzle-orm";

import { getDatabase } from "@/db/client";
import {
  authProfiles,
  environments,
  folders,
  importedDefinitions,
  importedOperations,
  importRuns,
  projects,
  requestBodies,
  requestHeaders,
  requestQueryParameters,
  savedRequests,
  variables,
  workspaces,
} from "@/db/schema";
import { parseAuthConfiguration } from "@/features/authentication/domain";
import { parseRequestSettings } from "@/features/requests/domain";

import {
  CollectionImportError,
  type CollectionImportConflict,
  type CollectionImportPreview,
  type CollectionImportResult,
  type CollectionImportSummary,
  type CollectionConflictStrategy,
  type PortableImportAuthProfile,
  type PortableImportPlan,
  type PortableImportRequest,
  type PortableImportVariable,
} from "../domain";
import { hashImportValue } from "../adapters/utils";

type Database = ReturnType<typeof getDatabase>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type QueryExecutor = Database | Transaction;

const genericFormats = ["httpie", "postman", "curl", "raw_http"] as const;

interface ImportOptions {
  definitionName: string;
  selectedRequestKeys: string[];
  includeEnvironments: boolean;
  includeProjectVariables: boolean;
  includeAuthProfiles: boolean;
  allowPrivateNetwork: boolean;
  conflictStrategy: CollectionConflictStrategy;
}

interface Counters {
  createdFolders: number;
  createdRequests: number;
  replacedRequests: number;
  mergedRequests: number;
  skippedRequests: number;
  createdEnvironments: number;
  createdVariables: number;
  createdAuthProfiles: number;
}

function lower(value: string) {
  return value.toLocaleLowerCase();
}

function folderKey(path: readonly string[]) {
  return path.map(lower).join("\u0000");
}

function uniqueName(
  requested: string,
  names: readonly string[],
  maximumLength = 120,
) {
  const existing = new Set(names.map(lower));
  const bounded = requested.slice(0, maximumLength);
  if (!existing.has(lower(bounded))) return bounded;
  let suffix = 2;
  while (true) {
    const suffixText = ` ${suffix}`;
    const candidate = `${requested.slice(0, maximumLength - suffixText.length)}${suffixText}`;
    if (!existing.has(lower(candidate))) return candidate;
    suffix += 1;
  }
}

function requestCopyName(requested: string, names: readonly string[]) {
  return uniqueName(`${requested} copy`, names);
}

async function targetProject(executor: QueryExecutor, projectId: string) {
  const [target] = await executor
    .select({
      projectId: projects.id,
      projectName: projects.name,
      workspaceId: workspaces.id,
      workspaceName: workspaces.name,
    })
    .from(projects)
    .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!target) {
    throw new CollectionImportError("Project not found.", "PROJECT_NOT_FOUND");
  }
  return target;
}

async function nextPosition(
  executor: QueryExecutor,
  table: typeof folders | typeof savedRequests,
  projectId: string,
  parentId: string | null,
) {
  const [row] = await executor
    .select({ value: max(table.position) })
    .from(table)
    .where(
      and(
        table === folders
          ? eq(folders.projectId, projectId)
          : eq(savedRequests.projectId, projectId),
        table === folders
          ? parentId
            ? eq(folders.parentId, parentId)
            : isNull(folders.parentId)
          : parentId
            ? eq(savedRequests.folderId, parentId)
            : isNull(savedRequests.folderId),
      ),
    );
  return Number(row?.value ?? -1) + 1;
}

function folderPaths(
  rows: Array<{ id: string; parentId: string | null; name: string }>,
) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const paths = new Map<string, string[]>();
  const pathFor = (id: string, seen = new Set<string>()): string[] => {
    const cached = paths.get(id);
    if (cached) return cached;
    const row = byId.get(id);
    if (!row || seen.has(id)) return [];
    seen.add(id);
    const path = [
      ...(row.parentId ? pathFor(row.parentId, seen) : []),
      row.name,
    ];
    paths.set(id, path);
    return path;
  };
  rows.forEach(({ id }) => pathFor(id));
  return paths;
}

export async function previewCollectionImport(
  projectId: string,
  plan: PortableImportPlan,
): Promise<CollectionImportPreview> {
  const database = getDatabase();
  const target = await targetProject(database, projectId);
  const [
    folderRows,
    requestRows,
    environmentRows,
    variableRows,
    profileRows,
    definitionRows,
  ] = await Promise.all([
    database.select().from(folders).where(eq(folders.projectId, projectId)),
    database
      .select()
      .from(savedRequests)
      .where(eq(savedRequests.projectId, projectId)),
    database
      .select({ name: environments.name })
      .from(environments)
      .where(eq(environments.projectId, projectId)),
    database
      .select({ name: variables.name })
      .from(variables)
      .where(
        and(eq(variables.scope, "project"), eq(variables.projectId, projectId)),
      ),
    database
      .select({ name: authProfiles.name })
      .from(authProfiles)
      .where(
        or(
          eq(authProfiles.projectId, projectId),
          eq(authProfiles.workspaceId, target.workspaceId),
        ),
      ),
    database
      .select({
        id: importedDefinitions.id,
        name: importedDefinitions.name,
        sourceHash: importedDefinitions.sourceHash,
      })
      .from(importedDefinitions)
      .where(
        and(
          eq(importedDefinitions.projectId, projectId),
          inArray(importedDefinitions.format, genericFormats),
        ),
      ),
  ]);
  const pathById = folderPaths(folderRows);
  const folderByPath = new Map(
    folderRows.map((folder) => [
      folderKey(pathById.get(folder.id) ?? []),
      folder,
    ]),
  );
  const conflicts: CollectionImportConflict[] = [];
  const desiredFolders = new Map<string, string[]>();
  for (const request of plan.requests) {
    request.folderPath.forEach((_name, index) => {
      const path = request.folderPath.slice(0, index + 1);
      desiredFolders.set(folderKey(path), path);
    });
    const folder = folderByPath.get(folderKey(request.folderPath));
    const requestConflict = requestRows.find(
      (row) =>
        row.folderId === (folder?.id ?? null) &&
        lower(row.name) === lower(request.name),
    );
    if (requestConflict) {
      conflicts.push({
        key: `request:${request.sourceKey}`,
        kind: "request",
        label: request.name,
        details: `A request named ${request.name} already exists in ${request.folderPath.join(" / ") || "the project root"}.`,
      });
    }
  }
  for (const [key, path] of desiredFolders) {
    if (folderByPath.has(key)) {
      conflicts.push({
        key: `folder:${key}`,
        kind: "folder",
        label: path.join(" / "),
        details: "The existing folder path will be reused.",
      });
    }
  }
  for (const environment of plan.environments) {
    if (
      environmentRows.some(
        ({ name }) => lower(name) === lower(environment.name),
      )
    ) {
      conflicts.push({
        key: `environment:${environment.sourceKey}`,
        kind: "environment",
        label: environment.name,
        details: `Project environment ${environment.name} already exists.`,
      });
    }
  }
  for (const variable of plan.projectVariables) {
    if (variableRows.some(({ name }) => lower(name) === lower(variable.name))) {
      conflicts.push({
        key: `variable:${lower(variable.name)}`,
        kind: "variable",
        label: variable.name,
        details: `Project variable ${variable.name} already exists.`,
      });
    }
  }
  for (const profile of plan.authProfiles) {
    if (profileRows.some(({ name }) => lower(name) === lower(profile.name))) {
      conflicts.push({
        key: `auth:${profile.sourceKey}`,
        kind: "auth_profile",
        label: profile.name,
        details: `Authentication profile ${profile.name} already exists.`,
      });
    }
  }
  const duplicate = definitionRows.find(
    (definition) =>
      definition.sourceHash === plan.sourceHash ||
      lower(definition.name) === lower(plan.name),
  );
  const warnings = duplicate
    ? [
        ...new Set([
          ...plan.warnings,
          `Imported source ${duplicate.name} already exists; resources will follow the selected conflict strategy.`,
        ]),
      ]
    : plan.warnings;
  return {
    ...plan,
    warnings,
    target: {
      workspaceId: target.workspaceId,
      workspaceName: target.workspaceName,
      projectId: target.projectId,
      projectName: target.projectName,
    },
    conflicts,
  };
}

async function ensureFolders(
  executor: Transaction,
  projectId: string,
  requests: PortableImportRequest[],
  counters: Counters,
) {
  const existing = await executor
    .select()
    .from(folders)
    .where(eq(folders.projectId, projectId));
  const paths = folderPaths(existing);
  const byPath = new Map(
    existing.map((folder) => [
      folderKey(paths.get(folder.id) ?? []),
      folder.id,
    ]),
  );
  const requested = new Map<string, string[]>();
  requests.forEach((request) =>
    request.folderPath.forEach((_part, index) => {
      const path = request.folderPath.slice(0, index + 1);
      requested.set(folderKey(path), path);
    }),
  );
  const ordered = [...requested.values()].sort(
    (left, right) => left.length - right.length,
  );
  for (const path of ordered) {
    const key = folderKey(path);
    if (byPath.has(key)) continue;
    const parentPath = path.slice(0, -1);
    const parentId = byPath.get(folderKey(parentPath)) ?? null;
    const position = await nextPosition(executor, folders, projectId, parentId);
    const [created] = await executor
      .insert(folders)
      .values({ projectId, parentId, name: path.at(-1)!, position })
      .returning({ id: folders.id });
    if (!created)
      throw new CollectionImportError("An import folder could not be created.");
    byPath.set(key, created.id);
    counters.createdFolders += 1;
  }
  return byPath;
}

async function writeAuthProfiles(
  executor: Transaction,
  target: Awaited<ReturnType<typeof targetProject>>,
  proposals: PortableImportAuthProfile[],
  strategy: CollectionConflictStrategy,
  counters: Counters,
) {
  const existing = await executor
    .select()
    .from(authProfiles)
    .where(
      or(
        eq(authProfiles.projectId, target.projectId),
        eq(authProfiles.workspaceId, target.workspaceId),
      ),
    );
  const result = new Map<string, string>();
  for (const proposal of proposals) {
    const match = existing.find(
      ({ name }) => lower(name) === lower(proposal.name),
    );
    if (match && match.projectId && strategy === "replace") {
      await executor
        .update(authProfiles)
        .set({
          type: proposal.type,
          configuration: parseAuthConfiguration(proposal.configuration),
          updatedAt: new Date(),
        })
        .where(eq(authProfiles.id, match.id));
      result.set(proposal.sourceKey, match.id);
      continue;
    }
    if (match && match.projectId && strategy === "merge") {
      await executor
        .update(authProfiles)
        .set({
          type: proposal.type,
          configuration: parseAuthConfiguration({
            ...(match.configuration as Record<string, unknown>),
            ...proposal.configuration,
          }),
          updatedAt: new Date(),
        })
        .where(eq(authProfiles.id, match.id));
      result.set(proposal.sourceKey, match.id);
      continue;
    }
    if (match && strategy !== "rename") {
      result.set(proposal.sourceKey, match.id);
      continue;
    }
    const name = uniqueName(
      proposal.name,
      existing.map((profile) => profile.name),
    );
    const [created] = await executor
      .insert(authProfiles)
      .values({
        workspaceId: null,
        projectId: target.projectId,
        tokenRequestId: null,
        name,
        type: proposal.type,
        configuration: parseAuthConfiguration(proposal.configuration),
      })
      .returning({ id: authProfiles.id, name: authProfiles.name });
    if (!created)
      throw new CollectionImportError(
        "An authentication profile could not be created.",
      );
    existing.push({
      id: created.id,
      name: created.name,
      workspaceId: null,
      projectId: target.projectId,
      tokenRequestId: null,
      type: proposal.type,
      configuration: parseAuthConfiguration(proposal.configuration),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    result.set(proposal.sourceKey, created.id);
    counters.createdAuthProfiles += 1;
  }
  return result;
}

async function writeVariables(
  executor: Transaction,
  projectId: string,
  imported: PortableImportVariable[],
  strategy: CollectionConflictStrategy,
  counters: Counters,
) {
  const existing = await executor
    .select()
    .from(variables)
    .where(
      and(eq(variables.scope, "project"), eq(variables.projectId, projectId)),
    );
  for (const variable of imported) {
    const match = existing.find(
      ({ name }) => lower(name) === lower(variable.name),
    );
    if (match && (strategy === "replace" || strategy === "merge")) {
      await executor
        .update(variables)
        .set({
          value: variable.value,
          secret: variable.secret,
          enabled: variable.enabled,
          updatedAt: new Date(),
        })
        .where(eq(variables.id, match.id));
      continue;
    }
    if (match && strategy === "skip") continue;
    const name = uniqueName(
      variable.name,
      existing.map((item) => item.name),
      128,
    );
    const [created] = await executor
      .insert(variables)
      .values({
        projectId,
        scope: "project",
        name,
        value: variable.value,
        secret: variable.secret,
        enabled: variable.enabled,
      })
      .returning();
    if (created) {
      existing.push(created);
      counters.createdVariables += 1;
    }
  }
}

async function writeEnvironmentVariables(
  executor: Transaction,
  environmentId: string,
  imported: PortableImportVariable[],
  merge: boolean,
  counters: Counters,
) {
  const existing = merge
    ? await executor
        .select()
        .from(variables)
        .where(eq(variables.environmentId, environmentId))
    : [];
  for (const variable of imported) {
    const match = existing.find(
      ({ name }) => lower(name) === lower(variable.name),
    );
    if (match) {
      await executor
        .update(variables)
        .set({
          value: variable.value,
          secret: variable.secret,
          enabled: variable.enabled,
          updatedAt: new Date(),
        })
        .where(eq(variables.id, match.id));
    } else {
      const [created] = await executor
        .insert(variables)
        .values({ environmentId, scope: "project_environment", ...variable })
        .returning();
      if (created) {
        existing.push(created);
        counters.createdVariables += 1;
      }
    }
  }
}

async function writeEnvironments(
  executor: Transaction,
  target: Awaited<ReturnType<typeof targetProject>>,
  imported: PortableImportPlan["environments"],
  strategy: CollectionConflictStrategy,
  counters: Counters,
) {
  const existing = await executor
    .select()
    .from(environments)
    .where(eq(environments.projectId, target.projectId));
  for (const environment of imported) {
    const match = existing.find(
      ({ name }) => lower(name) === lower(environment.name),
    );
    if (match && strategy === "skip") continue;
    if (match && strategy === "replace") {
      await executor
        .delete(variables)
        .where(eq(variables.environmentId, match.id));
      await writeEnvironmentVariables(
        executor,
        match.id,
        environment.variables,
        false,
        counters,
      );
      continue;
    }
    if (match && strategy === "merge") {
      await writeEnvironmentVariables(
        executor,
        match.id,
        environment.variables,
        true,
        counters,
      );
      continue;
    }
    const name = uniqueName(
      environment.name,
      existing.map((item) => item.name),
    );
    const [created] = await executor
      .insert(environments)
      .values({
        workspaceId: target.workspaceId,
        projectId: target.projectId,
        name,
        description: `Imported from ${environment.sourceKey}`,
      })
      .returning();
    if (!created)
      throw new CollectionImportError("An environment could not be created.");
    existing.push(created);
    counters.createdEnvironments += 1;
    await writeEnvironmentVariables(
      executor,
      created.id,
      environment.variables,
      false,
      counters,
    );
  }
}

async function existingRequestState(executor: Transaction, requestId: string) {
  const [[request], headers, queryParameters, requestVariables, bodies] =
    await Promise.all([
      executor
        .select()
        .from(savedRequests)
        .where(eq(savedRequests.id, requestId))
        .limit(1),
      executor
        .select()
        .from(requestHeaders)
        .where(eq(requestHeaders.requestId, requestId))
        .orderBy(asc(requestHeaders.position)),
      executor
        .select()
        .from(requestQueryParameters)
        .where(eq(requestQueryParameters.requestId, requestId))
        .orderBy(asc(requestQueryParameters.position)),
      executor
        .select()
        .from(variables)
        .where(
          and(
            eq(variables.scope, "request"),
            eq(variables.requestId, requestId),
          ),
        )
        .orderBy(asc(variables.name)),
      executor
        .select()
        .from(requestBodies)
        .where(eq(requestBodies.requestId, requestId))
        .limit(1),
    ]);
  if (!request)
    throw new CollectionImportError("A conflicting request no longer exists.");
  return {
    request,
    headers,
    queryParameters,
    requestVariables,
    body: bodies[0],
  };
}

function mergedFields<T extends { name: string }>(
  existing: T[],
  imported: T[],
) {
  const result = [...existing];
  for (const item of imported) {
    const index = result.findIndex(
      ({ name }) => lower(name) === lower(item.name),
    );
    if (index < 0) result.push(item);
    else result[index] = item;
  }
  return result;
}

async function writeRequest(
  executor: Transaction,
  projectId: string,
  folderId: string | null,
  request: PortableImportRequest,
  name: string,
  authProfileId: string | null,
  allowPrivateNetwork: boolean,
  mode: "create" | "replace" | "merge",
  requestId?: string,
) {
  const previous =
    requestId && mode === "merge"
      ? await existingRequestState(executor, requestId)
      : null;
  const headers = previous
    ? mergedFields(
        previous.headers.map(({ name, value, enabled, secret }) => ({
          name,
          value,
          enabled,
          secret,
        })),
        request.headers,
      )
    : request.headers;
  const queryParameters = previous
    ? mergedFields(
        previous.queryParameters.map(({ name, value, enabled }) => ({
          name,
          value,
          enabled,
          secret: false,
        })),
        request.queryParameters,
      )
    : request.queryParameters;
  const requestVariables = previous
    ? mergedFields(
        previous.requestVariables.map(({ name, value, enabled, secret }) => ({
          name,
          value,
          enabled,
          secret,
        })),
        request.requestVariables,
      )
    : request.requestVariables;
  const body =
    previous?.body && request.body.type === "none"
      ? {
          type: previous.body.type,
          content: previous.body.content,
          contentType: previous.body.contentType,
          metadata: previous.body.metadata,
        }
      : request.body;
  const settings = parseRequestSettings({
    ...(previous?.request.settings as Record<string, unknown> | undefined),
    ...request.settings,
    allowPrivateNetwork,
  });
  const values = {
    projectId,
    folderId,
    authProfileId: authProfileId ?? previous?.request.authProfileId ?? null,
    name,
    description: request.description || previous?.request.description || "",
    method: request.method,
    url: request.url,
    tags: previous?.request.tags ?? ([] as string[]),
    settings,
  };
  let id = requestId;
  if (id) {
    await executor
      .update(savedRequests)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(savedRequests.id, id));
    await Promise.all([
      executor.delete(requestHeaders).where(eq(requestHeaders.requestId, id)),
      executor
        .delete(requestQueryParameters)
        .where(eq(requestQueryParameters.requestId, id)),
      executor
        .delete(variables)
        .where(
          and(eq(variables.scope, "request"), eq(variables.requestId, id)),
        ),
    ]);
  } else {
    const position = await nextPosition(
      executor,
      savedRequests,
      projectId,
      folderId,
    );
    const [created] = await executor
      .insert(savedRequests)
      .values({ ...values, position })
      .returning({ id: savedRequests.id });
    if (!created)
      throw new CollectionImportError(
        "An imported request could not be created.",
      );
    id = created.id;
  }
  if (headers.length) {
    await executor.insert(requestHeaders).values(
      headers.map((field, position) => ({
        requestId: id!,
        ...field,
        position,
      })),
    );
  }
  if (queryParameters.length) {
    await executor.insert(requestQueryParameters).values(
      queryParameters.map((field, position) => ({
        requestId: id!,
        name: field.name,
        value: field.value,
        enabled: field.enabled,
        position,
      })),
    );
  }
  if (requestVariables.length) {
    await executor.insert(variables).values(
      requestVariables.map((variable) => ({
        requestId: id!,
        scope: "request" as const,
        ...variable,
      })),
    );
  }
  await executor
    .insert(requestBodies)
    .values({ requestId: id, ...body })
    .onConflictDoUpdate({
      target: requestBodies.requestId,
      set: { ...body, updatedAt: new Date() },
    });
  const state = {
    name,
    description: values.description,
    method: values.method,
    url: values.url,
    folderId,
    authProfileId: values.authProfileId,
    tags: values.tags,
    queryParameters: queryParameters.map((item) => ({
      ...item,
      secret: false,
    })),
    headers,
    requestVariables: [...requestVariables].sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
    outputDefinitions: [],
    body,
    settings,
  };
  return { id, generatedRequestHash: hashImportValue(state) };
}

async function requestConflict(
  executor: Transaction,
  projectId: string,
  folderId: string | null,
  name: string,
) {
  const [match] = await executor
    .select()
    .from(savedRequests)
    .where(
      and(
        eq(savedRequests.projectId, projectId),
        folderId
          ? eq(savedRequests.folderId, folderId)
          : isNull(savedRequests.folderId),
        sql`lower(${savedRequests.name}) = lower(${name})`,
      ),
    )
    .limit(1);
  return match ?? null;
}

async function persistRequest(
  executor: Transaction,
  definitionId: string,
  projectId: string,
  request: PortableImportRequest,
  folderId: string | null,
  authProfileId: string | null,
  options: ImportOptions,
  counters: Counters,
  warnings: string[],
) {
  const conflict = await requestConflict(
    executor,
    projectId,
    folderId,
    request.name,
  );
  let name = request.name;
  let requestId: string | undefined;
  let mode: "create" | "replace" | "merge" = "create";
  if (conflict && options.conflictStrategy === "skip") {
    counters.skippedRequests += 1;
    warnings.push(
      `${request.name} was retained as source metadata without a request because the conflicting request was skipped.`,
    );
    await executor.insert(importedOperations).values({
      definitionId,
      sourceKey: request.sourceKey,
      method: request.method,
      path: request.url,
      operationId: request.sourceKey,
      summary: request.name,
      tags: request.folderPath,
      operation: request,
      operationHash: hashImportValue(request),
      requestId: null,
      generatedRequestHash: null,
      customized: false,
    });
    return;
  }
  if (
    conflict &&
    (options.conflictStrategy === "replace" ||
      options.conflictStrategy === "merge")
  ) {
    const [linked] = await executor
      .select({ id: importedOperations.id })
      .from(importedOperations)
      .where(eq(importedOperations.requestId, conflict.id))
      .limit(1);
    if (linked) {
      const names = await executor
        .select({ name: savedRequests.name })
        .from(savedRequests)
        .where(
          and(
            eq(savedRequests.projectId, projectId),
            folderId
              ? eq(savedRequests.folderId, folderId)
              : isNull(savedRequests.folderId),
          ),
        );
      name = requestCopyName(
        request.name,
        names.map((item) => item.name),
      );
      warnings.push(
        `${request.name} was renamed to ${name} because the existing request belongs to another imported source.`,
      );
    } else {
      requestId = conflict.id;
      mode = options.conflictStrategy;
      if (mode === "replace") counters.replacedRequests += 1;
      else counters.mergedRequests += 1;
    }
  } else if (conflict) {
    const names = await executor
      .select({ name: savedRequests.name })
      .from(savedRequests)
      .where(
        and(
          eq(savedRequests.projectId, projectId),
          folderId
            ? eq(savedRequests.folderId, folderId)
            : isNull(savedRequests.folderId),
        ),
      );
    name = requestCopyName(
      request.name,
      names.map((item) => item.name),
    );
  }
  const written = await writeRequest(
    executor,
    projectId,
    folderId,
    request,
    name,
    authProfileId,
    options.allowPrivateNetwork,
    mode,
    requestId,
  );
  if (!requestId) counters.createdRequests += 1;
  await executor.insert(importedOperations).values({
    definitionId,
    sourceKey: request.sourceKey,
    method: request.method,
    path: request.url,
    operationId: request.sourceKey,
    summary: request.name,
    tags: request.folderPath,
    operation: request,
    operationHash: hashImportValue(request),
    requestId: written.id,
    generatedRequestHash: written.generatedRequestHash,
    customized: false,
  });
}

export async function executeCollectionImport(input: {
  projectId: string;
  plan: PortableImportPlan;
  approvedSourceHash: string;
  sourceType: "paste" | "file";
  originalDocument: string;
  options: ImportOptions;
}): Promise<CollectionImportResult> {
  if (input.plan.sourceHash !== input.approvedSourceHash) {
    throw new CollectionImportError(
      "The import source changed after preview. Preview it again before importing.",
      "IMPORT_PREVIEW_STALE",
    );
  }
  const selected = new Set(input.options.selectedRequestKeys);
  const requests = input.plan.requests.filter(({ sourceKey }) =>
    selected.has(sourceKey),
  );
  if (requests.length !== selected.size) {
    throw new CollectionImportError(
      "The request selection no longer matches the preview.",
      "IMPORT_SELECTION_INVALID",
    );
  }
  const database = getDatabase();
  return database.transaction(async (transaction) => {
    const target = await targetProject(transaction, input.projectId);
    const counters: Counters = {
      createdFolders: 0,
      createdRequests: 0,
      replacedRequests: 0,
      mergedRequests: 0,
      skippedRequests: 0,
      createdEnvironments: 0,
      createdVariables: 0,
      createdAuthProfiles: 0,
    };
    const warnings = [...input.plan.warnings, ...input.plan.unsupported];
    if (!input.options.includeAuthProfiles) {
      const omitted = requests.filter(
        ({ authProfileKey }) => authProfileKey,
      ).length;
      if (omitted) {
        warnings.push(
          `${omitted} imported request${omitted === 1 ? "" : "s"} referenced authentication that was not included.`,
        );
      }
    }
    const [definition] = await transaction
      .insert(importedDefinitions)
      .values({
        projectId: input.projectId,
        name: input.options.definitionName,
        format: input.plan.format,
        sourceType: input.sourceType,
        sourceUrl: null,
        originalDocument: input.originalDocument,
        sourceHash: input.plan.sourceHash,
        version: input.plan.formatVersion,
        title: input.plan.name,
        apiVersion: null,
        metadata: {
          importer: "collection-importer-v1",
          selectedRequestKeys: input.options.selectedRequestKeys,
          options: input.options,
          unsupported: input.plan.unsupported,
        },
      })
      .returning({ id: importedDefinitions.id });
    if (!definition)
      throw new CollectionImportError(
        "The imported source could not be saved.",
      );
    const folderIds = await ensureFolders(
      transaction,
      input.projectId,
      requests,
      counters,
    );
    const authIds = input.options.includeAuthProfiles
      ? await writeAuthProfiles(
          transaction,
          target,
          input.plan.authProfiles,
          input.options.conflictStrategy,
          counters,
        )
      : new Map<string, string>();
    if (input.options.includeProjectVariables) {
      await writeVariables(
        transaction,
        input.projectId,
        input.plan.projectVariables,
        input.options.conflictStrategy,
        counters,
      );
    }
    if (input.options.includeEnvironments) {
      await writeEnvironments(
        transaction,
        target,
        input.plan.environments,
        input.options.conflictStrategy,
        counters,
      );
    }
    for (const request of requests) {
      await persistRequest(
        transaction,
        definition.id,
        input.projectId,
        request,
        folderIds.get(folderKey(request.folderPath)) ?? null,
        request.authProfileKey
          ? (authIds.get(request.authProfileKey) ?? null)
          : null,
        input.options,
        counters,
        warnings,
      );
    }
    await transaction.insert(importRuns).values({
      definitionId: definition.id,
      projectId: input.projectId,
      format: input.plan.format,
      status: "completed",
      summary: { requestCount: requests.length, ...counters },
      warnings,
      sourceDocument: input.originalDocument,
      sourceHash: input.plan.sourceHash,
      changes: requests.map((request) => ({
        key: `request:${request.sourceKey}`,
        category: "added",
      })),
    });
    return {
      definitionId: definition.id,
      ...counters,
      warnings: [...new Set(warnings)],
    };
  });
}

export async function listCollectionImports(
  projectId: string,
): Promise<CollectionImportSummary[]> {
  const database = getDatabase();
  await targetProject(database, projectId);
  const [definitions, operations] = await Promise.all([
    database
      .select()
      .from(importedDefinitions)
      .where(
        and(
          eq(importedDefinitions.projectId, projectId),
          inArray(importedDefinitions.format, genericFormats),
        ),
      )
      .orderBy(asc(importedDefinitions.name)),
    database
      .select({
        definitionId: importedOperations.definitionId,
        requestId: importedOperations.requestId,
      })
      .from(importedOperations)
      .innerJoin(
        importedDefinitions,
        eq(importedDefinitions.id, importedOperations.definitionId),
      )
      .where(
        and(
          eq(importedDefinitions.projectId, projectId),
          inArray(importedDefinitions.format, genericFormats),
        ),
      ),
  ]);
  return definitions.map((definition) => {
    const items = operations.filter(
      (operation) => operation.definitionId === definition.id,
    );
    return {
      id: definition.id,
      projectId: definition.projectId,
      name: definition.name,
      format: definition.format as CollectionImportSummary["format"],
      sourceType: definition.sourceType as "paste" | "file",
      requestCount: items.length,
      linkedRequestCount: items.filter(({ requestId }) => Boolean(requestId))
        .length,
      importedAt: definition.importedAt.toISOString(),
    };
  });
}
