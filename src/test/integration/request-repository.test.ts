import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closeDatabase } from "@/db/client";
import {
  completeExecution,
  createExecutionRecord,
  createSavedRequest,
  deleteSavedRequest,
  duplicateSavedRequest,
  getExecutionDetail,
  getSavedRequestDetail,
  relocateSavedRequest,
  updateSavedRequest,
} from "@/features/requests/data/request-repository";
import {
  createFolder,
  createProject,
  createWorkspace,
  duplicateProject,
  getWorkbenchNavigation,
} from "@/features/workspaces/data/workspace-repository";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("saved request repository", () => {
  let client: ReturnType<typeof postgres>;

  beforeAll(() => {
    client = postgres(databaseUrl as string, { max: 1, prepare: false });
  });

  beforeEach(async () => {
    await client`truncate table workspaces, application_settings restart identity cascade`;
  });

  afterAll(async () => {
    await closeDatabase();
    await client.end({ timeout: 5 });
  });

  async function hierarchy() {
    const workspace = await createWorkspace({
      name: "Work",
      description: null,
    });
    const project = await createProject({
      workspaceId: workspace.id,
      name: "Facts API",
      description: null,
    });
    const folder = await createFolder({
      projectId: project.id,
      parentId: null,
      name: "Facts",
    });
    return { workspace, project, folder };
  }

  it("persists, moves, and duplicates all request components", async () => {
    const { project, folder } = await hierarchy();
    const request = await createSavedRequest({
      projectId: project.id,
      folderId: null,
      name: "List facts",
      method: "GET",
      url: "https://example.test/facts",
    });
    await updateSavedRequest({
      id: request.id,
      name: "List facts",
      description: "Returns facts",
      method: "POST",
      url: "https://example.test/facts",
      folderId: null,
      tags: ["facts"],
      queryParameters: [{ name: "limit", value: "20", enabled: true }],
      headers: [
        {
          name: "Authorization",
          value: "Bearer secret",
          enabled: true,
          secret: true,
        },
      ],
      requestVariables: [
        {
          name: "topic",
          value: "space",
          enabled: true,
          secret: false,
        },
      ],
      body: {
        type: "json",
        content: '{"topic":"space"}',
        contentType: "application/json",
        metadata: {},
      },
      settings: {
        timeoutMs: 5_000,
        followRedirects: true,
        maxRedirects: 3,
        tlsVerify: true,
        maxResponseBytes: 100_000,
        allowPrivateNetwork: false,
        cookies: [],
      },
    });
    await relocateSavedRequest(request.id, folder.id);
    const copy = await duplicateSavedRequest(request.id);

    const detail = await getSavedRequestDetail(copy.id);
    expect(detail).toMatchObject({
      name: "List facts copy",
      folderId: folder.id,
      method: "POST",
      tags: ["facts"],
      queryParameters: [{ name: "limit", value: "20", enabled: true }],
      headers: [{ name: "Authorization", secret: true }],
      requestVariables: [{ name: "topic", value: "space" }],
      body: { type: "json", content: '{"topic":"space"}' },
    });

    await duplicateProject(project.id);
    const navigation = await getWorkbenchNavigation();
    expect(navigation.workspaces[0]?.projects[1]?.requests[0]).toMatchObject({
      name: "List facts",
      folderId: expect.any(String),
    });
    expect(navigation.workspaces[0]?.projects[1]?.requests).toHaveLength(2);
  });

  it("retains redacted execution history after a saved request is deleted", async () => {
    const { project } = await hierarchy();
    const request = await createSavedRequest({
      projectId: project.id,
      folderId: null,
      name: "Health",
      method: "GET",
      url: "https://example.test/health",
    });
    const executionId = crypto.randomUUID();
    await createExecutionRecord({
      id: executionId,
      projectId: project.id,
      requestId: request.id,
      method: "GET",
      resolvedUrl: "https://example.test/health",
      requestSnapshot: {
        headers: [{ name: "Authorization", value: "••••••••" }],
      },
    });
    await completeExecution(executionId, {
      statusCode: 200,
      statusText: "OK",
      durationMs: 12,
      sizeBytes: 11,
      headers: [{ name: "content-type", value: "application/json" }],
      cookies: [],
      redirects: [],
      bodyPreview: '{"ok":true}',
      bodyTruncated: false,
      contentType: "application/json",
    });

    expect((await getSavedRequestDetail(request.id)).history[0]).toMatchObject({
      id: executionId,
      status: "succeeded",
      response: { statusCode: 200, bodyPreview: '{"ok":true}' },
    });
    await deleteSavedRequest(request.id);
    expect(await getExecutionDetail(executionId)).toMatchObject({
      requestId: null,
      projectId: project.id,
      response: { statusCode: 200 },
    });
  });

  it("bounds project history to the latest 100 executions", async () => {
    const { project } = await hierarchy();
    const request = await createSavedRequest({
      projectId: project.id,
      folderId: null,
      name: "Bounded history",
      method: "GET",
      url: "https://example.test/history",
    });
    await client`
      insert into request_executions (
        project_id,
        request_id,
        status,
        method,
        resolved_url,
        request_snapshot,
        started_at,
        completed_at,
        created_at,
        updated_at
      )
      select
        ${project.id}::uuid,
        ${request.id}::uuid,
        'succeeded'::execution_status,
        'GET',
        'https://example.test/history',
        '{}'::jsonb,
        now(),
        now(),
        now() - (sequence || ' seconds')::interval,
        now()
      from generate_series(1, 101) as sequence
    `;
    const finalId = crypto.randomUUID();
    await createExecutionRecord({
      id: finalId,
      projectId: project.id,
      requestId: request.id,
      method: "GET",
      resolvedUrl: "https://example.test/history",
      requestSnapshot: {},
    });
    await completeExecution(finalId, {
      statusCode: 204,
      statusText: "No Content",
      durationMs: 1,
      sizeBytes: 0,
      headers: [],
      cookies: [],
      redirects: [],
      bodyPreview: "",
      bodyTruncated: false,
      contentType: null,
    });

    const [{ count }] = await client<{ count: number }[]>`
      select count(*)::int as count
      from request_executions
      where project_id = ${project.id}::uuid
    `;
    expect(count).toBe(100);
    expect((await getExecutionDetail(finalId)).status).toBe("succeeded");
  });
});
