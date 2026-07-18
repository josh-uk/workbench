import "server-only";

import { and, asc, eq, inArray, isNull, max, ne, or, sql } from "drizzle-orm";

import { getDatabase } from "@/db/client";
import {
  authProfiles,
  folders,
  importedDefinitions,
  importedOperations,
  importRuns,
  projects,
  requestBodies,
  requestHeaders,
  requestOutputDefinitions,
  requestQueryParameters,
  savedRequests,
  variables,
} from "@/db/schema";
import { parseAuthConfiguration } from "@/features/authentication/domain";
import { parseRequestSettings } from "@/features/requests/domain";
import { createRequestCopyName } from "@/features/requests/domain";

import {
  type ImportedDefinitionSummary,
  type OpenApiImportPreview,
  type OpenApiImportResult,
  type OpenApiOperationPreview,
  type OpenApiRefreshPreview,
  type OpenApiRefreshResult,
  OpenApiDomainError,
  openApiImportOptionsSchema,
  type OpenApiSourceType,
  type ParsedOpenApiDefinition,
} from "../domain";
import {
  diffOpenApiDefinitions,
  hashOpenApiValue,
  materialiseOpenApiRequest,
} from "../parser";
import type { z } from "zod";

type Database = ReturnType<typeof getDatabase>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type QueryExecutor = Database | Transaction;
type ImportOptions = z.infer<typeof openApiImportOptionsSchema>;
type StoredImportOptions = ImportOptions & {
  serverVariableValue?: string | null;
};

const openApiFormats = ["openapi_json", "openapi_yaml"] as const;

interface StoredDefinitionMetadata {
  servers: ParsedOpenApiDefinition["servers"];
  tags: ParsedOpenApiDefinition["tags"];
  securitySchemes: ParsedOpenApiDefinition["securitySchemes"];
  securityProposals: ParsedOpenApiDefinition["securityProposals"];
  schemas: ParsedOpenApiDefinition["schemas"];
  globalSecurity: ParsedOpenApiDefinition["globalSecurity"];
  options: StoredImportOptions;
  source: ImportSourceMetadata;
}

interface ImportSourceMetadata {
  sourceType: OpenApiSourceType;
  sourceUrl: string | null;
  allowPrivateNetwork: boolean;
}

interface WriteContext {
  executor: Transaction;
  project: { id: string; workspaceId: string };
  parsed: ParsedOpenApiDefinition;
  options: ImportOptions;
  source: ImportSourceMetadata;
  folderIds: Map<string, string | null>;
  authProfileIds: Map<string, string>;
  serverVariableName: string | null;
  serverVariablePreserved: boolean;
  counters: {
    createdFolders: number;
    createdAuthProfiles: number;
    createdRequests: number;
    replacedRequests: number;
    skippedRequests: number;
  };
  warnings: string[];
}

async function getProject(executor: QueryExecutor, id: string) {
  const [project] = await executor
    .select({ id: projects.id, workspaceId: projects.workspaceId })
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  if (!project) {
    throw new OpenApiDomainError("Project not found.", "PROJECT_NOT_FOUND");
  }
  return project;
}

async function getDefinition(executor: QueryExecutor, id: string) {
  const [definition] = await executor
    .select()
    .from(importedDefinitions)
    .where(
      and(
        eq(importedDefinitions.id, id),
        inArray(importedDefinitions.format, openApiFormats),
      ),
    )
    .limit(1);
  if (!definition) {
    throw new OpenApiDomainError(
      "Imported definition not found.",
      "IMPORTED_DEFINITION_NOT_FOUND",
    );
  }
  return definition;
}

function definitionMetadata(
  parsed: ParsedOpenApiDefinition,
  options: StoredImportOptions,
  source: ImportSourceMetadata,
): StoredDefinitionMetadata {
  return {
    servers: parsed.servers,
    tags: parsed.tags,
    securitySchemes: parsed.securitySchemes,
    securityProposals: parsed.securityProposals,
    schemas: parsed.schemas,
    globalSecurity: parsed.globalSecurity,
    options,
    source,
  };
}

function readMetadata(value: unknown): StoredDefinitionMetadata {
  const metadata =
    value && typeof value === "object"
      ? (value as Partial<StoredDefinitionMetadata>)
      : {};
  const fallbackOptions: ImportOptions = {
    name: "Imported API",
    selectedOperationKeys: [],
    tagFolders: {},
    createServerVariable: false,
    serverVariableName: "baseUrl",
    createAuthProfiles: false,
    conflictStrategy: "rename",
  };
  return {
    servers: Array.isArray(metadata.servers) ? metadata.servers : [],
    tags: Array.isArray(metadata.tags) ? metadata.tags : [],
    securitySchemes: metadata.securitySchemes ?? {},
    securityProposals: Array.isArray(metadata.securityProposals)
      ? metadata.securityProposals
      : [],
    schemas: metadata.schemas ?? {},
    globalSecurity: Array.isArray(metadata.globalSecurity)
      ? metadata.globalSecurity
      : [],
    options: { ...fallbackOptions, ...(metadata.options ?? {}) },
    source: {
      sourceType: metadata.source?.sourceType ?? "paste",
      sourceUrl: metadata.source?.sourceUrl ?? null,
      allowPrivateNetwork: metadata.source?.allowPrivateNetwork ?? false,
    },
  };
}

function storedOperation(
  value: unknown,
  row: typeof importedOperations.$inferSelect,
): OpenApiOperationPreview {
  if (
    value &&
    typeof value === "object" &&
    "generatedRequest" in value &&
    "sourceKey" in value
  ) {
    return value as OpenApiOperationPreview;
  }
  throw new OpenApiDomainError(
    `Stored operation ${row.sourceKey} is invalid.`,
    "IMPORTED_OPERATION_INVALID",
  );
}

function storedSnapshot(
  definition: typeof importedDefinitions.$inferSelect,
  rows: Array<typeof importedOperations.$inferSelect>,
): ParsedOpenApiDefinition {
  const metadata = readMetadata(definition.metadata);
  return {
    format: definition.format as "openapi_json" | "openapi_yaml",
    originalDocument: definition.originalDocument,
    sourceHash: definition.sourceHash,
    openapiVersion: definition.version ?? "3.0.0",
    title: definition.title ?? definition.name,
    apiVersion: definition.apiVersion,
    ...metadata,
    operations: rows.map((row) => storedOperation(row.operation, row)),
    warnings: [],
  };
}

async function operationRows(executor: QueryExecutor, definitionId: string) {
  return executor
    .select()
    .from(importedOperations)
    .where(eq(importedOperations.definitionId, definitionId))
    .orderBy(asc(importedOperations.sourceKey));
}

async function nextPosition(
  executor: QueryExecutor,
  table: typeof folders | typeof savedRequests,
  projectId: string,
  ownerId: string | null,
) {
  const ownerCondition =
    table === folders
      ? ownerId
        ? eq(folders.parentId, ownerId)
        : isNull(folders.parentId)
      : ownerId
        ? eq(savedRequests.folderId, ownerId)
        : isNull(savedRequests.folderId);
  const [result] = await executor
    .select({ value: max(table.position) })
    .from(table)
    .where(
      and(
        table === folders
          ? eq(folders.projectId, projectId)
          : eq(savedRequests.projectId, projectId),
        ownerCondition,
      ),
    );
  return Number(result?.value ?? -1) + 1;
}

function requestState(input: {
  name: string;
  description: string | null;
  method: string;
  url: string;
  folderId: string | null;
  authProfileId: string | null;
  tags: string[];
  queryParameters: unknown[];
  headers: unknown[];
  requestVariables: unknown[];
  outputDefinitions: unknown[];
  body: unknown;
  settings: unknown;
}) {
  return {
    name: input.name,
    description: input.description ?? "",
    method: input.method,
    url: input.url,
    folderId: input.folderId,
    authProfileId: input.authProfileId,
    tags: input.tags,
    queryParameters: input.queryParameters,
    headers: input.headers,
    requestVariables: input.requestVariables,
    outputDefinitions: input.outputDefinitions,
    body: input.body,
    settings: input.settings,
  };
}

async function requestHash(executor: QueryExecutor, requestId: string) {
  const [request] = await executor
    .select()
    .from(savedRequests)
    .where(eq(savedRequests.id, requestId))
    .limit(1);
  if (!request) return null;
  const [
    queryParameters,
    headers,
    requestVariables,
    outputDefinitions,
    bodies,
  ] = await Promise.all([
    executor
      .select({
        name: requestQueryParameters.name,
        value: requestQueryParameters.value,
        enabled: requestQueryParameters.enabled,
        secret: sql<boolean>`false`,
      })
      .from(requestQueryParameters)
      .where(eq(requestQueryParameters.requestId, requestId))
      .orderBy(asc(requestQueryParameters.position)),
    executor
      .select({
        name: requestHeaders.name,
        value: requestHeaders.value,
        enabled: requestHeaders.enabled,
        secret: requestHeaders.secret,
      })
      .from(requestHeaders)
      .where(eq(requestHeaders.requestId, requestId))
      .orderBy(asc(requestHeaders.position)),
    executor
      .select({
        name: variables.name,
        value: variables.value,
        enabled: variables.enabled,
        secret: variables.secret,
      })
      .from(variables)
      .where(
        and(eq(variables.scope, "request"), eq(variables.requestId, requestId)),
      )
      .orderBy(asc(variables.name)),
    executor
      .select({
        name: requestOutputDefinitions.name,
        jsonPath: requestOutputDefinitions.jsonPath,
        expiresInJsonPath: requestOutputDefinitions.expiresInJsonPath,
        secret: requestOutputDefinitions.secret,
      })
      .from(requestOutputDefinitions)
      .where(eq(requestOutputDefinitions.requestId, requestId))
      .orderBy(asc(requestOutputDefinitions.position)),
    executor
      .select()
      .from(requestBodies)
      .where(eq(requestBodies.requestId, requestId))
      .limit(1),
  ]);
  const body = bodies[0];
  return hashOpenApiValue(
    requestState({
      ...request,
      queryParameters,
      headers,
      requestVariables,
      outputDefinitions,
      body: body
        ? {
            type: body.type,
            content: body.content,
            contentType: body.contentType,
            metadata: body.metadata,
          }
        : { type: "none", content: null, contentType: null, metadata: {} },
      settings: request.settings,
    }),
  );
}

async function createServerVariable(
  executor: Transaction,
  projectId: string,
  requestedName: string,
  value: string,
  strategy: ImportOptions["conflictStrategy"],
  previousGeneratedValue?: string | null,
) {
  const existing = await executor
    .select()
    .from(variables)
    .where(
      and(eq(variables.scope, "project"), eq(variables.projectId, projectId)),
    )
    .orderBy(asc(variables.name));
  const match = existing.find(
    (variable) =>
      variable.name.toLocaleLowerCase() === requestedName.toLocaleLowerCase(),
  );
  if (!match) {
    await executor.insert(variables).values({
      projectId,
      scope: "project",
      name: requestedName,
      value,
      enabled: true,
      secret: false,
    });
    return { name: requestedName, preserved: false };
  }
  if (match.value === value) return { name: match.name, preserved: false };
  if (
    previousGeneratedValue !== undefined &&
    match.value === previousGeneratedValue
  ) {
    await executor
      .update(variables)
      .set({ value, updatedAt: new Date() })
      .where(eq(variables.id, match.id));
    return { name: match.name, preserved: false };
  }
  if (previousGeneratedValue !== undefined) {
    return { name: match.name, preserved: true };
  }
  if (strategy === "replace") {
    await executor
      .update(variables)
      .set({ value, updatedAt: new Date() })
      .where(eq(variables.id, match.id));
    return { name: match.name, preserved: false };
  }
  if (strategy === "skip") return { name: null, preserved: false };
  const names = new Set(existing.map(({ name }) => name.toLocaleLowerCase()));
  let suffix = 2;
  while (names.has(`${requestedName}${suffix}`.toLocaleLowerCase()))
    suffix += 1;
  const name = `${requestedName}${suffix}`.slice(0, 128);
  await executor.insert(variables).values({
    projectId,
    scope: "project",
    name,
    value,
    enabled: true,
    secret: false,
  });
  return { name, preserved: false };
}

async function prepareContext(
  executor: Transaction,
  project: { id: string; workspaceId: string },
  parsed: ParsedOpenApiDefinition,
  options: ImportOptions,
  source: ImportSourceMetadata,
  refresh?: { previousServerVariableValue: string | null },
) {
  const context: WriteContext = {
    executor,
    project,
    parsed,
    options,
    source,
    folderIds: new Map(),
    authProfileIds: new Map(),
    serverVariableName: null,
    serverVariablePreserved: false,
    counters: {
      createdFolders: 0,
      createdAuthProfiles: 0,
      createdRequests: 0,
      replacedRequests: 0,
      skippedRequests: 0,
    },
    warnings: [...parsed.warnings],
  };
  if (options.createServerVariable && parsed.servers[0]) {
    const serverVariable = await createServerVariable(
      executor,
      project.id,
      options.serverVariableName,
      parsed.servers[0].resolvedUrl,
      options.conflictStrategy,
      refresh?.previousServerVariableValue,
    );
    context.serverVariableName = serverVariable.name;
    context.serverVariablePreserved = serverVariable.preserved;
    if (!context.serverVariableName) {
      context.warnings.push(
        `Project variable ${options.serverVariableName} already exists and was skipped; generated requests use full server URLs.`,
      );
    } else if (context.serverVariablePreserved) {
      context.warnings.push(
        `Project variable ${context.serverVariableName} was changed after import and was preserved.`,
      );
    }
  }
  await prepareAuthProfiles(context);
  return context;
}

async function prepareAuthProfiles(context: WriteContext) {
  const existing = await context.executor
    .select()
    .from(authProfiles)
    .where(
      or(
        eq(authProfiles.projectId, context.project.id),
        eq(authProfiles.workspaceId, context.project.workspaceId),
      ),
    );
  for (const proposal of context.parsed.securityProposals) {
    if (!proposal.supported) continue;
    const match = existing.find(
      (profile) =>
        profile.name.toLocaleLowerCase() === proposal.name.toLocaleLowerCase(),
    );
    if (match) {
      context.authProfileIds.set(proposal.schemeName, match.id);
      continue;
    }
    if (!context.options.createAuthProfiles) continue;
    const [profile] = await context.executor
      .insert(authProfiles)
      .values({
        projectId: context.project.id,
        workspaceId: null,
        tokenRequestId: null,
        name: proposal.name,
        type: proposal.type,
        configuration: parseAuthConfiguration(proposal.configuration),
      })
      .returning({ id: authProfiles.id });
    if (profile) {
      context.authProfileIds.set(proposal.schemeName, profile.id);
      context.counters.createdAuthProfiles += 1;
    }
  }
}

async function folderForOperation(
  context: WriteContext,
  operation: OpenApiOperationPreview,
) {
  const folderName =
    context.options.tagFolders[operation.primaryTag] ?? operation.primaryTag;
  if (!folderName) return null;
  const key = folderName.toLocaleLowerCase();
  if (context.folderIds.has(key)) return context.folderIds.get(key) ?? null;
  const [existing] = await context.executor
    .select({ id: folders.id })
    .from(folders)
    .where(
      and(
        eq(folders.projectId, context.project.id),
        isNull(folders.parentId),
        sql`lower(${folders.name}) = lower(${folderName})`,
      ),
    )
    .limit(1);
  if (existing) {
    context.folderIds.set(key, existing.id);
    return existing.id;
  }
  const position = await nextPosition(
    context.executor,
    folders,
    context.project.id,
    null,
  );
  const [folder] = await context.executor
    .insert(folders)
    .values({
      projectId: context.project.id,
      parentId: null,
      name: folderName,
      position,
    })
    .returning({ id: folders.id });
  if (!folder)
    throw new OpenApiDomainError("Import folder could not be created.");
  context.folderIds.set(key, folder.id);
  context.counters.createdFolders += 1;
  return folder.id;
}

function authProfileForOperation(
  context: WriteContext,
  operation: OpenApiOperationPreview,
) {
  for (const name of operation.securitySchemeNames) {
    const profileId = context.authProfileIds.get(name);
    if (profileId) return profileId;
  }
  return null;
}

async function writeRequest(
  context: WriteContext,
  operation: OpenApiOperationPreview,
  input: {
    requestId?: string;
    name: string;
    folderId: string | null;
    authProfileId: string | null;
  },
) {
  const generated = materialiseOpenApiRequest(
    operation,
    context.serverVariableName,
  );
  const settings = parseRequestSettings({
    allowPrivateNetwork: context.source.allowPrivateNetwork,
  });
  const values = {
    projectId: context.project.id,
    folderId: input.folderId,
    authProfileId: input.authProfileId,
    name: input.name,
    description: generated.description,
    method: generated.method,
    url: generated.url,
    tags: generated.tags,
    settings,
  };
  let requestId = input.requestId;
  if (requestId) {
    await context.executor
      .update(savedRequests)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(savedRequests.id, requestId));
    await Promise.all([
      context.executor
        .delete(requestHeaders)
        .where(eq(requestHeaders.requestId, requestId)),
      context.executor
        .delete(requestQueryParameters)
        .where(eq(requestQueryParameters.requestId, requestId)),
      context.executor
        .delete(variables)
        .where(
          and(
            eq(variables.scope, "request"),
            eq(variables.requestId, requestId),
          ),
        ),
    ]);
  } else {
    const position = await nextPosition(
      context.executor,
      savedRequests,
      context.project.id,
      input.folderId,
    );
    const [request] = await context.executor
      .insert(savedRequests)
      .values({ ...values, position })
      .returning({ id: savedRequests.id });
    if (!request)
      throw new OpenApiDomainError("Imported request could not be created.");
    requestId = request.id;
  }
  if (generated.headers.length) {
    await context.executor.insert(requestHeaders).values(
      generated.headers.map((header, index) => ({
        requestId,
        ...header,
        position: index,
      })),
    );
  }
  if (generated.queryParameters.length) {
    await context.executor.insert(requestQueryParameters).values(
      generated.queryParameters.map((parameter, index) => ({
        requestId,
        name: parameter.name,
        value: parameter.value,
        enabled: parameter.enabled,
        position: index,
      })),
    );
  }
  if (generated.requestVariables.length) {
    await context.executor.insert(variables).values(
      generated.requestVariables.map((variable) => ({
        requestId,
        scope: "request" as const,
        ...variable,
      })),
    );
  }
  await context.executor
    .insert(requestBodies)
    .values({ requestId, ...generated.body })
    .onConflictDoUpdate({
      target: requestBodies.requestId,
      set: { ...generated.body, updatedAt: new Date() },
    });
  const generatedRequestHash = hashOpenApiValue(
    requestState({
      ...values,
      queryParameters: generated.queryParameters.map((item) => ({
        name: item.name,
        value: item.value,
        enabled: item.enabled,
        secret: false,
      })),
      headers: generated.headers,
      requestVariables: [...generated.requestVariables].sort((left, right) =>
        left.name.localeCompare(right.name),
      ),
      outputDefinitions: [],
      body: generated.body,
      settings,
    }),
  );
  return { requestId, generatedRequestHash };
}

async function requestConflict(
  executor: QueryExecutor,
  projectId: string,
  folderId: string | null,
  name: string,
  excludeId?: string,
) {
  const conditions = [
    eq(savedRequests.projectId, projectId),
    folderId
      ? eq(savedRequests.folderId, folderId)
      : isNull(savedRequests.folderId),
    sql`lower(${savedRequests.name}) = lower(${name})`,
  ];
  if (excludeId) conditions.push(ne(savedRequests.id, excludeId));
  const [request] = await executor
    .select({ id: savedRequests.id, name: savedRequests.name })
    .from(savedRequests)
    .where(and(...conditions))
    .limit(1);
  return request ?? null;
}

async function persistOperation(
  context: WriteContext,
  definitionId: string,
  operation: OpenApiOperationPreview,
) {
  const folderId = await folderForOperation(context, operation);
  const authProfileId = authProfileForOperation(context, operation);
  const conflict = await requestConflict(
    context.executor,
    context.project.id,
    folderId,
    operation.name,
  );
  if (conflict && context.options.conflictStrategy === "skip") {
    await context.executor.insert(importedOperations).values({
      definitionId,
      sourceKey: operation.sourceKey,
      method: operation.method,
      path: operation.path,
      operationId: operation.operationId,
      summary: operation.summary,
      tags: operation.tags,
      operation,
      operationHash: operation.operationHash,
      requestId: null,
      generatedRequestHash: null,
      customized: false,
    });
    context.counters.skippedRequests += 1;
    context.warnings.push(
      `${operation.sourceKey} was retained without a request because ${conflict.name} already exists.`,
    );
    return;
  }
  let name = operation.name;
  let requestId: string | undefined;
  if (conflict) {
    if (context.options.conflictStrategy === "replace") {
      const [linkedImport] = await context.executor
        .select({ id: importedOperations.id })
        .from(importedOperations)
        .where(eq(importedOperations.requestId, conflict.id))
        .limit(1);
      if (linkedImport) {
        const names = await context.executor
          .select({ name: savedRequests.name })
          .from(savedRequests)
          .where(
            and(
              eq(savedRequests.projectId, context.project.id),
              folderId
                ? eq(savedRequests.folderId, folderId)
                : isNull(savedRequests.folderId),
            ),
          );
        name = createRequestCopyName(
          operation.name,
          names.map((item) => item.name),
        );
        context.warnings.push(
          `${operation.sourceKey} was renamed to ${name} because the conflicting request belongs to another imported operation.`,
        );
      } else {
        requestId = conflict.id;
        context.counters.replacedRequests += 1;
      }
    } else {
      const names = await context.executor
        .select({ name: savedRequests.name })
        .from(savedRequests)
        .where(
          and(
            eq(savedRequests.projectId, context.project.id),
            folderId
              ? eq(savedRequests.folderId, folderId)
              : isNull(savedRequests.folderId),
          ),
        );
      name = createRequestCopyName(
        operation.name,
        names.map((item) => item.name),
      );
    }
  }
  const written = await writeRequest(context, operation, {
    requestId,
    name,
    folderId,
    authProfileId,
  });
  if (!requestId) context.counters.createdRequests += 1;
  await context.executor.insert(importedOperations).values({
    definitionId,
    sourceKey: operation.sourceKey,
    method: operation.method,
    path: operation.path,
    operationId: operation.operationId,
    summary: operation.summary,
    tags: operation.tags,
    operation,
    operationHash: operation.operationHash,
    requestId: written.requestId,
    generatedRequestHash: written.generatedRequestHash,
    customized: false,
  });
}

export async function previewOpenApiImport(
  projectId: string,
  parsed: ParsedOpenApiDefinition,
): Promise<OpenApiImportPreview> {
  const database = getDatabase();
  await getProject(database, projectId);
  const [folderRows, requestRows, profileRows, variableRows, definitionRows] =
    await Promise.all([
      database
        .select()
        .from(folders)
        .where(and(eq(folders.projectId, projectId), isNull(folders.parentId))),
      database
        .select()
        .from(savedRequests)
        .where(eq(savedRequests.projectId, projectId)),
      database
        .select({ name: authProfiles.name })
        .from(authProfiles)
        .where(eq(authProfiles.projectId, projectId)),
      database
        .select({ name: variables.name, value: variables.value })
        .from(variables)
        .where(
          and(
            eq(variables.scope, "project"),
            eq(variables.projectId, projectId),
          ),
        ),
      database
        .select()
        .from(importedDefinitions)
        .where(
          and(
            eq(importedDefinitions.projectId, projectId),
            inArray(importedDefinitions.format, openApiFormats),
          ),
        ),
    ]);
  const folderByName = new Map(
    folderRows.map((folder) => [folder.name.toLocaleLowerCase(), folder.id]),
  );
  const operations = parsed.operations.map((operation) => {
    const folderId = folderByName.get(operation.primaryTag.toLocaleLowerCase());
    const conflict = requestRows.find(
      (request) =>
        request.folderId === (folderId ?? null) &&
        request.name.toLocaleLowerCase() === operation.name.toLocaleLowerCase(),
    );
    return {
      ...operation,
      conflict: conflict
        ? `Request ${conflict.name} already exists in ${operation.primaryTag}.`
        : null,
    };
  });
  const conflicts = [
    ...operations.flatMap((operation) =>
      operation.conflict ? [operation.conflict] : [],
    ),
    ...parsed.securityProposals.flatMap((proposal) =>
      profileRows.some(
        (profile) =>
          profile.name.toLocaleLowerCase() ===
          proposal.name.toLocaleLowerCase(),
      )
        ? [
            `Authentication profile ${proposal.name} already exists and will be reused.`,
          ]
        : [],
    ),
    ...variableRows.flatMap((variable) =>
      variable.name.toLocaleLowerCase() === "baseurl" &&
      variable.value !== parsed.servers[0]?.resolvedUrl
        ? ["Project variable baseUrl already exists with another value."]
        : [],
    ),
  ];
  const existingDefinition = definitionRows.find(
    (definition) =>
      definition.sourceHash === parsed.sourceHash ||
      definition.name.toLocaleLowerCase() === parsed.title.toLocaleLowerCase(),
  );
  if (existingDefinition) {
    conflicts.unshift(
      `Imported definition ${existingDefinition.name} already exists; use refresh to update it.`,
    );
  }
  return {
    ...parsed,
    operations,
    projectId,
    existingDefinitionId: existingDefinition?.id ?? null,
    conflicts: [...new Set(conflicts)],
  };
}

export async function executeOpenApiImport(input: {
  projectId: string;
  parsed: ParsedOpenApiDefinition;
  source: ImportSourceMetadata;
  options: ImportOptions;
}): Promise<OpenApiImportResult> {
  const selected = new Set(input.options.selectedOperationKeys);
  const operations = input.parsed.operations.filter((operation) =>
    selected.has(operation.sourceKey),
  );
  if (operations.length !== selected.size) {
    throw new OpenApiDomainError(
      "The operation selection no longer matches the preview.",
      "OPENAPI_SELECTION_INVALID",
    );
  }
  const database = getDatabase();
  return database.transaction(async (transaction) => {
    const project = await getProject(transaction, input.projectId);
    const [existingDefinition] = await transaction
      .select({ id: importedDefinitions.id })
      .from(importedDefinitions)
      .where(
        and(
          eq(importedDefinitions.projectId, project.id),
          inArray(importedDefinitions.format, openApiFormats),
          or(
            eq(importedDefinitions.sourceHash, input.parsed.sourceHash),
            sql`lower(${importedDefinitions.name}) = lower(${input.options.name})`,
          ),
        ),
      )
      .limit(1);
    if (existingDefinition) {
      throw new OpenApiDomainError(
        "This imported definition already exists. Refresh it instead of importing a duplicate.",
        "IMPORTED_DEFINITION_CONFLICT",
      );
    }
    const context = await prepareContext(
      transaction,
      project,
      input.parsed,
      input.options,
      input.source,
    );
    const [definition] = await transaction
      .insert(importedDefinitions)
      .values({
        projectId: project.id,
        name: input.options.name,
        format: input.parsed.format,
        sourceType: input.source.sourceType,
        sourceUrl: input.source.sourceUrl,
        originalDocument: input.parsed.originalDocument,
        sourceHash: input.parsed.sourceHash,
        version: input.parsed.openapiVersion,
        title: input.parsed.title,
        apiVersion: input.parsed.apiVersion,
        metadata: definitionMetadata(
          input.parsed,
          {
            ...input.options,
            createServerVariable: Boolean(context.serverVariableName),
            serverVariableName:
              context.serverVariableName ?? input.options.serverVariableName,
            serverVariableValue: context.serverVariableName
              ? (input.parsed.servers[0]?.resolvedUrl ?? null)
              : null,
          },
          input.source,
        ),
      })
      .returning({ id: importedDefinitions.id });
    if (!definition) {
      throw new OpenApiDomainError("Imported definition could not be created.");
    }
    for (const operation of operations) {
      await persistOperation(context, definition.id, operation);
    }
    await transaction.insert(importRuns).values({
      definitionId: definition.id,
      projectId: project.id,
      format: input.parsed.format,
      status: "completed",
      sourceDocument: input.parsed.originalDocument,
      sourceHash: input.parsed.sourceHash,
      summary: {
        operationCount: operations.length,
        ...context.counters,
      },
      warnings: context.warnings,
      changes: operations.map((operation) => ({
        key: `operation:${operation.sourceKey}`,
        category: "added",
      })),
    });
    return {
      definitionId: definition.id,
      ...context.counters,
      serverVariableName: context.serverVariableName,
      warnings: [...new Set(context.warnings)],
    };
  });
}

export async function listImportedDefinitions(
  projectId: string,
): Promise<ImportedDefinitionSummary[]> {
  const database = getDatabase();
  await getProject(database, projectId);
  const [definitions, operations] = await Promise.all([
    database
      .select()
      .from(importedDefinitions)
      .where(
        and(
          eq(importedDefinitions.projectId, projectId),
          inArray(importedDefinitions.format, openApiFormats),
        ),
      )
      .orderBy(asc(importedDefinitions.name)),
    database
      .select()
      .from(importedOperations)
      .innerJoin(
        importedDefinitions,
        eq(importedDefinitions.id, importedOperations.definitionId),
      )
      .where(
        and(
          eq(importedDefinitions.projectId, projectId),
          inArray(importedDefinitions.format, openApiFormats),
        ),
      ),
  ]);
  return definitions.map((definition) => {
    const metadata = readMetadata(definition.metadata);
    const items = operations
      .filter(({ imported_definitions: owner }) => owner.id === definition.id)
      .map(({ imported_operations: operation }) => operation);
    return {
      id: definition.id,
      projectId: definition.projectId,
      name: definition.name,
      format: definition.format as "openapi_json" | "openapi_yaml",
      sourceType: definition.sourceType,
      sourceUrl: definition.sourceUrl,
      allowPrivateNetwork: metadata.source.allowPrivateNetwork,
      openapiVersion: definition.version,
      title: definition.title,
      apiVersion: definition.apiVersion,
      operationCount: items.length,
      linkedRequestCount: items.filter(({ requestId }) => Boolean(requestId))
        .length,
      customizedRequestCount: items.filter(
        ({ customized, requestId }) => customized && Boolean(requestId),
      ).length,
      importedAt: definition.importedAt.toISOString(),
      updatedAt: definition.updatedAt.toISOString(),
    };
  });
}

async function customizedKeys(
  executor: QueryExecutor,
  rows: Array<typeof importedOperations.$inferSelect>,
) {
  const result = new Set<string>();
  for (const row of rows) {
    if (row.customized) {
      result.add(row.sourceKey);
      continue;
    }
    if (row.requestId && row.generatedRequestHash) {
      const current = await requestHash(executor, row.requestId);
      if (current !== row.generatedRequestHash) result.add(row.sourceKey);
    }
  }
  return result;
}

export async function previewOpenApiRefresh(
  definitionId: string,
  parsed: ParsedOpenApiDefinition,
): Promise<OpenApiRefreshPreview> {
  const database = getDatabase();
  const definition = await getDefinition(database, definitionId);
  const rows = await operationRows(database, definitionId);
  const current = storedSnapshot(definition, rows);
  const customized = await customizedKeys(database, rows);
  const diff = diffOpenApiDefinitions(current, parsed, customized);
  return {
    definitionId,
    definitionName: definition.name,
    source: parsed,
    ...diff,
  };
}

export async function applyOpenApiRefresh(input: {
  definitionId: string;
  parsed: ParsedOpenApiDefinition;
  source: ImportSourceMetadata;
  selectedChangeKeys: string[];
}): Promise<OpenApiRefreshResult> {
  const database = getDatabase();
  return database.transaction(async (transaction) => {
    const definition = await getDefinition(transaction, input.definitionId);
    const rows = await operationRows(transaction, input.definitionId);
    const current = storedSnapshot(definition, rows);
    const customized = await customizedKeys(transaction, rows);
    const diff = diffOpenApiDefinitions(current, input.parsed, customized);
    const available = new Set(diff.changes.map(({ key }) => key));
    const selected = new Set(input.selectedChangeKeys);
    if ([...selected].some((key) => !available.has(key))) {
      throw new OpenApiDomainError(
        "The refresh selection no longer matches the preview.",
        "OPENAPI_REFRESH_SELECTION_INVALID",
      );
    }
    const metadata = readMetadata(definition.metadata);
    const project = await getProject(transaction, definition.projectId);
    const contextParsed: ParsedOpenApiDefinition = {
      ...input.parsed,
      servers: selected.has("servers")
        ? input.parsed.servers
        : metadata.servers,
      securitySchemes: selected.has("security_schemes")
        ? input.parsed.securitySchemes
        : metadata.securitySchemes,
      securityProposals: selected.has("security_schemes")
        ? input.parsed.securityProposals
        : metadata.securityProposals,
    };
    const context = await prepareContext(
      transaction,
      project,
      contextParsed,
      metadata.options,
      input.source,
      {
        previousServerVariableValue:
          metadata.options.serverVariableValue ??
          metadata.servers[0]?.resolvedUrl ??
          null,
      },
    );
    const nextByKey = new Map(
      input.parsed.operations.map((operation) => [
        operation.sourceKey,
        operation,
      ]),
    );
    const rowByKey = new Map(rows.map((row) => [row.sourceKey, row]));
    const result: OpenApiRefreshResult = {
      definitionId: definition.id,
      added: 0,
      updated: 0,
      removed: 0,
      preservedCustomRequests: 0,
      warnings: [],
    };

    for (const change of diff.changes) {
      if (!selected.has(change.key) || !change.sourceKey) continue;
      const row = rowByKey.get(change.sourceKey);
      const next = nextByKey.get(change.sourceKey);
      if (change.category === "added" && next) {
        await persistOperation(context, definition.id, next);
        result.added += 1;
        continue;
      }
      if (change.category === "removed" && row) {
        if (row.requestId) {
          const currentHash = await requestHash(transaction, row.requestId);
          const isCustom =
            row.customized || currentHash !== row.generatedRequestHash;
          if (isCustom) {
            result.preservedCustomRequests += 1;
            result.warnings.push(
              `${row.sourceKey} was removed from the source, but its customized request was preserved.`,
            );
          } else {
            await transaction
              .delete(savedRequests)
              .where(eq(savedRequests.id, row.requestId));
          }
        }
        await transaction
          .delete(importedOperations)
          .where(eq(importedOperations.id, row.id));
        result.removed += 1;
        continue;
      }
      if (change.category === "changed" && row && next) {
        let generatedRequestHash = row.generatedRequestHash;
        let isCustom = row.customized;
        if (row.requestId) {
          const currentHash = await requestHash(transaction, row.requestId);
          isCustom = isCustom || currentHash !== row.generatedRequestHash;
          if (isCustom) {
            result.preservedCustomRequests += 1;
            result.warnings.push(
              `${row.sourceKey} changed, but its customized request was not overwritten.`,
            );
          } else {
            const [request] = await transaction
              .select({
                name: savedRequests.name,
                folderId: savedRequests.folderId,
              })
              .from(savedRequests)
              .where(eq(savedRequests.id, row.requestId))
              .limit(1);
            if (request) {
              const written = await writeRequest(context, next, {
                requestId: row.requestId,
                name: request.name,
                folderId: request.folderId,
                authProfileId: authProfileForOperation(context, next),
              });
              generatedRequestHash = written.generatedRequestHash;
            }
          }
        }
        await transaction
          .update(importedOperations)
          .set({
            method: next.method,
            path: next.path,
            operationId: next.operationId,
            summary: next.summary,
            tags: next.tags,
            operation: next,
            operationHash: next.operationHash,
            generatedRequestHash,
            customized: isCustom,
            updatedAt: new Date(),
          })
          .where(eq(importedOperations.id, row.id));
        result.updated += 1;
      }
    }

    const nextMetadata: StoredDefinitionMetadata = {
      ...metadata,
      servers: selected.has("servers")
        ? input.parsed.servers
        : metadata.servers,
      securitySchemes: selected.has("security_schemes")
        ? input.parsed.securitySchemes
        : metadata.securitySchemes,
      securityProposals: selected.has("security_schemes")
        ? input.parsed.securityProposals
        : metadata.securityProposals,
      schemas: selected.has("schemas")
        ? input.parsed.schemas
        : metadata.schemas,
      options: {
        ...metadata.options,
        serverVariableName:
          context.serverVariableName ?? metadata.options.serverVariableName,
        serverVariableValue: context.serverVariablePreserved
          ? (metadata.options.serverVariableValue ?? null)
          : (contextParsed.servers[0]?.resolvedUrl ?? null),
      },
      source: input.source,
    };
    await transaction
      .update(importedDefinitions)
      .set({
        format: input.parsed.format,
        sourceType: input.source.sourceType,
        sourceUrl: input.source.sourceUrl,
        originalDocument: input.parsed.originalDocument,
        sourceHash: input.parsed.sourceHash,
        version: input.parsed.openapiVersion,
        title: input.parsed.title,
        apiVersion: input.parsed.apiVersion,
        metadata: nextMetadata,
        importedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(importedDefinitions.id, definition.id));
    result.warnings.push(...context.warnings);
    await transaction.insert(importRuns).values({
      definitionId: definition.id,
      projectId: definition.projectId,
      format: input.parsed.format,
      status: "completed",
      sourceDocument: input.parsed.originalDocument,
      sourceHash: input.parsed.sourceHash,
      summary: {
        added: result.added,
        updated: result.updated,
        removed: result.removed,
        preservedCustomRequests: result.preservedCustomRequests,
      },
      warnings: result.warnings,
      changes: diff.changes.filter(({ key }) => selected.has(key)),
    });
    result.warnings = [...new Set(result.warnings)];
    return result;
  });
}

export async function detachImportedRequest(requestId: string) {
  const database = getDatabase();
  const [operation] = await database
    .select({ id: importedOperations.id })
    .from(importedOperations)
    .where(eq(importedOperations.requestId, requestId))
    .limit(1);
  if (!operation) {
    throw new OpenApiDomainError(
      "This request is not linked to an imported operation.",
      "IMPORTED_REQUEST_NOT_LINKED",
    );
  }
  await database
    .update(importedOperations)
    .set({ requestId: null, generatedRequestHash: null, customized: true })
    .where(eq(importedOperations.id, operation.id));
}

export async function getImportedRequestSource(requestId: string) {
  const [source] = await getDatabase()
    .select({
      definitionId: importedDefinitions.id,
      definitionName: importedDefinitions.name,
      sourceKey: importedOperations.sourceKey,
      customized: importedOperations.customized,
    })
    .from(importedOperations)
    .innerJoin(
      importedDefinitions,
      eq(importedDefinitions.id, importedOperations.definitionId),
    )
    .where(eq(importedOperations.requestId, requestId))
    .limit(1);
  return source ?? null;
}

export async function syncImportedRequestCustomization(
  executor: QueryExecutor,
  requestId: string,
) {
  const [operation] = await executor
    .select({
      id: importedOperations.id,
      generatedRequestHash: importedOperations.generatedRequestHash,
    })
    .from(importedOperations)
    .where(eq(importedOperations.requestId, requestId))
    .limit(1);
  if (!operation) return;
  const current = await requestHash(executor, requestId);
  await executor
    .update(importedOperations)
    .set({
      customized: current !== operation.generatedRequestHash,
      updatedAt: new Date(),
    })
    .where(eq(importedOperations.id, operation.id));
}
