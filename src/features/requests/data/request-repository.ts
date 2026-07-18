import "server-only";

import { and, asc, desc, eq, inArray, isNull, max, ne, sql } from "drizzle-orm";

import { getDatabase } from "@/db/client";
import {
  folders,
  projects,
  requestBodies,
  requestExecutions,
  requestHeaders,
  requestQueryParameters,
  responseMetadata,
  savedRequests,
} from "@/db/schema";
import {
  createRequestCopyName,
  type ExecutionDetail,
  parseRequestSettings,
  type RedirectHop,
  RequestDomainError,
  type RequestField,
  type ResponseCookie,
  type ResponseHeader,
  type SavedRequestDetail,
  type SavedRequestSummary,
  type updateSavedRequestSchema,
} from "@/features/requests/domain";
import type { z } from "zod";

type Database = ReturnType<typeof getDatabase>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type QueryExecutor = Database | Transaction;
type SavedRequestValues = z.infer<typeof updateSavedRequestSchema>;

export interface ExecutionSuccess {
  statusCode: number;
  statusText: string;
  durationMs: number;
  sizeBytes: number;
  headers: ResponseHeader[];
  cookies: ResponseCookie[];
  redirects: RedirectHop[];
  bodyPreview: string;
  bodyTruncated: boolean;
  contentType: string | null;
}

const HISTORY_LIMIT = 100;

function folderScopeCondition(projectId: string, folderId: string | null) {
  return and(
    eq(savedRequests.projectId, projectId),
    folderId
      ? eq(savedRequests.folderId, folderId)
      : isNull(savedRequests.folderId),
  );
}

async function getProject(executor: QueryExecutor, id: string) {
  const [project] = await executor
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  if (!project)
    throw new RequestDomainError("Project not found.", "PROJECT_NOT_FOUND");
  return project;
}

async function getFolder(executor: QueryExecutor, id: string) {
  const [folder] = await executor
    .select({ id: folders.id, projectId: folders.projectId })
    .from(folders)
    .where(eq(folders.id, id))
    .limit(1);
  if (!folder)
    throw new RequestDomainError("Folder not found.", "FOLDER_NOT_FOUND");
  return folder;
}

async function getRequestRow(executor: QueryExecutor, id: string) {
  const [request] = await executor
    .select()
    .from(savedRequests)
    .where(eq(savedRequests.id, id))
    .limit(1);
  if (!request)
    throw new RequestDomainError(
      "Saved request not found.",
      "REQUEST_NOT_FOUND",
    );
  return request;
}

async function assertFolderInProject(
  executor: QueryExecutor,
  projectId: string,
  folderId: string | null,
) {
  if (!folderId) return;
  const folder = await getFolder(executor, folderId);
  if (folder.projectId !== projectId) {
    throw new RequestDomainError(
      "Folder belongs to another project.",
      "FOLDER_PROJECT_MISMATCH",
    );
  }
}

async function assertNameAvailable(
  executor: QueryExecutor,
  projectId: string,
  folderId: string | null,
  name: string,
  excludeId?: string,
) {
  const conditions = [
    folderScopeCondition(projectId, folderId),
    sql`lower(${savedRequests.name}) = lower(${name})`,
  ];
  if (excludeId) conditions.push(ne(savedRequests.id, excludeId));

  const [existing] = await executor
    .select({ id: savedRequests.id })
    .from(savedRequests)
    .where(and(...conditions))
    .limit(1);
  if (existing) {
    throw new RequestDomainError(
      "A request with this name already exists here.",
      "REQUEST_NAME_CONFLICT",
    );
  }
}

async function nextPosition(
  executor: QueryExecutor,
  projectId: string,
  folderId: string | null,
) {
  const [result] = await executor
    .select({ value: max(savedRequests.position) })
    .from(savedRequests)
    .where(folderScopeCondition(projectId, folderId));
  return Number(result?.value ?? -1) + 1;
}

function toField(row: {
  name: string;
  value: string;
  enabled: boolean;
  secret?: boolean;
}): RequestField {
  return {
    name: row.name,
    value: row.value,
    enabled: row.enabled,
    secret: row.secret ?? false,
  };
}

function toExecutionDetail(row: {
  execution: typeof requestExecutions.$inferSelect;
  response: typeof responseMetadata.$inferSelect | null;
}): ExecutionDetail {
  const execution = row.execution;
  const response = row.response;
  return {
    id: execution.id,
    requestId: execution.requestId,
    projectId: execution.projectId,
    status: execution.status,
    method: execution.method,
    resolvedUrl: execution.resolvedUrl,
    requestSnapshot: execution.requestSnapshot as Record<string, unknown>,
    error: execution.error as { code: string; message: string } | null,
    startedAt: execution.startedAt?.toISOString() ?? null,
    completedAt: execution.completedAt?.toISOString() ?? null,
    createdAt: execution.createdAt.toISOString(),
    response: response
      ? {
          statusCode: response.statusCode,
          statusText: response.statusText,
          durationMs: response.durationMs,
          sizeBytes: response.sizeBytes,
          headers: response.headers as ResponseHeader[],
          cookies: response.cookies as ResponseCookie[],
          redirects: response.redirects as RedirectHop[],
          bodyPreview: response.bodyPreview,
          bodyTruncated: response.bodyTruncated,
          contentType: response.contentType,
        }
      : null,
  };
}

async function getHistory(
  executor: QueryExecutor,
  requestId: string,
  limit = 20,
) {
  const rows = await executor
    .select({ execution: requestExecutions, response: responseMetadata })
    .from(requestExecutions)
    .leftJoin(
      responseMetadata,
      eq(responseMetadata.executionId, requestExecutions.id),
    )
    .where(eq(requestExecutions.requestId, requestId))
    .orderBy(desc(requestExecutions.createdAt))
    .limit(limit);
  return rows.map(toExecutionDetail);
}

export async function getSavedRequestDetail(
  id: string,
): Promise<SavedRequestDetail> {
  const database = getDatabase();
  const request = await getRequestRow(database, id);
  const [headers, queryParameters, bodyRows, history] = await Promise.all([
    database
      .select()
      .from(requestHeaders)
      .where(eq(requestHeaders.requestId, id))
      .orderBy(asc(requestHeaders.position)),
    database
      .select()
      .from(requestQueryParameters)
      .where(eq(requestQueryParameters.requestId, id))
      .orderBy(asc(requestQueryParameters.position)),
    database
      .select()
      .from(requestBodies)
      .where(eq(requestBodies.requestId, id))
      .limit(1),
    getHistory(database, id),
  ]);
  const body = bodyRows[0];

  return {
    id: request.id,
    projectId: request.projectId,
    folderId: request.folderId,
    name: request.name,
    description: request.description,
    method: request.method,
    url: request.url,
    position: request.position,
    tags: request.tags,
    queryParameters: queryParameters.map(toField),
    headers: headers.map(toField),
    body: body
      ? {
          type: body.type,
          content: body.content,
          contentType: body.contentType,
          metadata: body.metadata as Record<string, unknown>,
        }
      : { type: "none", content: null, contentType: null, metadata: {} },
    settings: parseRequestSettings(request.settings),
    history,
  };
}

export async function listRequestSummaries(): Promise<SavedRequestSummary[]> {
  return getDatabase()
    .select({
      id: savedRequests.id,
      projectId: savedRequests.projectId,
      folderId: savedRequests.folderId,
      name: savedRequests.name,
      method: savedRequests.method,
      position: savedRequests.position,
    })
    .from(savedRequests)
    .orderBy(asc(savedRequests.position), asc(savedRequests.name));
}

export async function createSavedRequest(values: {
  projectId: string;
  folderId: string | null;
  name: string;
  method: SavedRequestSummary["method"];
  url: string;
}) {
  const database = getDatabase();
  return database.transaction(async (transaction) => {
    await getProject(transaction, values.projectId);
    await assertFolderInProject(transaction, values.projectId, values.folderId);

    const names = await transaction
      .select({ name: savedRequests.name })
      .from(savedRequests)
      .where(folderScopeCondition(values.projectId, values.folderId));
    const name = names.some(
      (item) =>
        item.name.toLocaleLowerCase() === values.name.toLocaleLowerCase(),
    )
      ? createRequestCopyName(
          values.name,
          names.map((item) => item.name),
        )
      : values.name;
    const position = await nextPosition(
      transaction,
      values.projectId,
      values.folderId,
    );
    const [request] = await transaction
      .insert(savedRequests)
      .values({ ...values, name, position, settings: parseRequestSettings({}) })
      .returning({ id: savedRequests.id });
    if (!request) throw new RequestDomainError("Request could not be created.");

    await transaction.insert(requestBodies).values({ requestId: request.id });
    return request;
  });
}

export async function updateSavedRequest(values: SavedRequestValues) {
  const database = getDatabase();
  await database.transaction(async (transaction) => {
    const request = await getRequestRow(transaction, values.id);
    await assertFolderInProject(
      transaction,
      request.projectId,
      values.folderId,
    );
    await assertNameAvailable(
      transaction,
      request.projectId,
      values.folderId,
      values.name,
      values.id,
    );

    let position = request.position;
    if (request.folderId !== values.folderId) {
      position = await nextPosition(
        transaction,
        request.projectId,
        values.folderId,
      );
    }

    await transaction
      .update(savedRequests)
      .set({
        folderId: values.folderId,
        name: values.name,
        description: values.description,
        method: values.method,
        url: values.url,
        tags: values.tags,
        settings: values.settings,
        position,
        updatedAt: new Date(),
      })
      .where(eq(savedRequests.id, values.id));

    await transaction
      .delete(requestHeaders)
      .where(eq(requestHeaders.requestId, values.id));
    if (values.headers.length) {
      await transaction.insert(requestHeaders).values(
        values.headers.map((header, index) => ({
          requestId: values.id,
          ...header,
          position: index,
        })),
      );
    }

    await transaction
      .delete(requestQueryParameters)
      .where(eq(requestQueryParameters.requestId, values.id));
    if (values.queryParameters.length) {
      await transaction.insert(requestQueryParameters).values(
        values.queryParameters.map((parameter, index) => ({
          requestId: values.id,
          name: parameter.name,
          value: parameter.value,
          enabled: parameter.enabled,
          position: index,
        })),
      );
    }

    await transaction
      .insert(requestBodies)
      .values({ requestId: values.id, ...values.body })
      .onConflictDoUpdate({
        target: requestBodies.requestId,
        set: { ...values.body, updatedAt: new Date() },
      });
  });
}

export async function duplicateSavedRequest(id: string) {
  const source = await getSavedRequestDetail(id);
  const database = getDatabase();

  return database.transaction(async (transaction) => {
    const names = await transaction
      .select({ name: savedRequests.name })
      .from(savedRequests)
      .where(folderScopeCondition(source.projectId, source.folderId));
    const name = createRequestCopyName(
      source.name,
      names.map((item) => item.name),
    );
    const position = await nextPosition(
      transaction,
      source.projectId,
      source.folderId,
    );
    const [copy] = await transaction
      .insert(savedRequests)
      .values({
        projectId: source.projectId,
        folderId: source.folderId,
        name,
        description: source.description,
        method: source.method,
        url: source.url,
        position,
        tags: source.tags,
        settings: source.settings,
      })
      .returning({ id: savedRequests.id });
    if (!copy) throw new RequestDomainError("Request could not be duplicated.");

    if (source.headers.length) {
      await transaction.insert(requestHeaders).values(
        source.headers.map((header, index) => ({
          requestId: copy.id,
          ...header,
          position: index,
        })),
      );
    }
    if (source.queryParameters.length) {
      await transaction.insert(requestQueryParameters).values(
        source.queryParameters.map((parameter, index) => ({
          requestId: copy.id,
          name: parameter.name,
          value: parameter.value,
          enabled: parameter.enabled,
          position: index,
        })),
      );
    }
    await transaction.insert(requestBodies).values({
      requestId: copy.id,
      ...source.body,
    });
    return copy;
  });
}

export async function deleteSavedRequest(id: string) {
  const database = getDatabase();
  await getRequestRow(database, id);
  await database.delete(savedRequests).where(eq(savedRequests.id, id));
}

export async function moveSavedRequest(id: string, direction: "up" | "down") {
  const database = getDatabase();
  await database.transaction(async (transaction) => {
    const request = await getRequestRow(transaction, id);
    const siblings = await transaction
      .select({ id: savedRequests.id, position: savedRequests.position })
      .from(savedRequests)
      .where(folderScopeCondition(request.projectId, request.folderId))
      .orderBy(asc(savedRequests.position), asc(savedRequests.name));
    const index = siblings.findIndex((item) => item.id === id);
    const target = siblings[index + (direction === "up" ? -1 : 1)];
    if (!target) return;

    await transaction
      .update(savedRequests)
      .set({ position: target.position, updatedAt: new Date() })
      .where(eq(savedRequests.id, id));
    await transaction
      .update(savedRequests)
      .set({ position: request.position, updatedAt: new Date() })
      .where(eq(savedRequests.id, target.id));
  });
}

export async function relocateSavedRequest(
  id: string,
  folderId: string | null,
) {
  const database = getDatabase();
  await database.transaction(async (transaction) => {
    const request = await getRequestRow(transaction, id);
    if (request.folderId === folderId) return;
    await assertFolderInProject(transaction, request.projectId, folderId);
    await assertNameAvailable(
      transaction,
      request.projectId,
      folderId,
      request.name,
      request.id,
    );
    const position = await nextPosition(
      transaction,
      request.projectId,
      folderId,
    );
    await transaction
      .update(savedRequests)
      .set({ folderId, position, updatedAt: new Date() })
      .where(eq(savedRequests.id, id));
  });
}

export async function createExecutionRecord(input: {
  id: string;
  projectId: string;
  requestId: string;
  method: string;
  resolvedUrl: string;
  requestSnapshot: Record<string, unknown>;
}) {
  await getDatabase()
    .insert(requestExecutions)
    .values({
      ...input,
      status: "running",
      startedAt: new Date(),
    });
}

async function trimHistory(executor: QueryExecutor, projectId: string) {
  const expired = await executor
    .select({ id: requestExecutions.id })
    .from(requestExecutions)
    .where(eq(requestExecutions.projectId, projectId))
    .orderBy(desc(requestExecutions.createdAt))
    .offset(HISTORY_LIMIT);
  if (expired.length) {
    await executor.delete(requestExecutions).where(
      inArray(
        requestExecutions.id,
        expired.map((item) => item.id),
      ),
    );
  }
}

export async function completeExecution(id: string, result: ExecutionSuccess) {
  const database = getDatabase();
  await database.transaction(async (transaction) => {
    const [execution] = await transaction
      .update(requestExecutions)
      .set({
        status: "succeeded",
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(requestExecutions.id, id))
      .returning({ projectId: requestExecutions.projectId });
    if (!execution) throw new RequestDomainError("Execution not found.");
    await transaction
      .insert(responseMetadata)
      .values({ executionId: id, ...result });
    await trimHistory(transaction, execution.projectId);
  });
}

export async function failExecution(
  id: string,
  error: { code: string; message: string },
  cancelled: boolean,
) {
  const database = getDatabase();
  await database.transaction(async (transaction) => {
    const [execution] = await transaction
      .update(requestExecutions)
      .set({
        status: cancelled ? "cancelled" : "failed",
        error,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(requestExecutions.id, id))
      .returning({ projectId: requestExecutions.projectId });
    if (execution) await trimHistory(transaction, execution.projectId);
  });
}

export async function getExecutionDetail(id: string) {
  const [row] = await getDatabase()
    .select({ execution: requestExecutions, response: responseMetadata })
    .from(requestExecutions)
    .leftJoin(
      responseMetadata,
      eq(responseMetadata.executionId, requestExecutions.id),
    )
    .where(eq(requestExecutions.id, id))
    .limit(1);
  if (!row)
    throw new RequestDomainError("Execution not found.", "EXECUTION_NOT_FOUND");
  return toExecutionDetail(row);
}
