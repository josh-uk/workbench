import http from "node:http";

import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AssertionDefinition } from "@/core/assertions/domain";
import { closeDatabase } from "@/db/client";
import {
  createSavedRequest,
  getSavedRequestDetail,
  updateSavedRequest,
} from "@/features/requests/data/request-repository";
import {
  getWorkflowDetail,
  listWorkflows,
  saveWorkflow,
} from "@/features/workflows/data/workflow-repository";
import { runWorkflow } from "@/features/workflows/runner";
import {
  createProject,
  createWorkspace,
  duplicateProject,
} from "@/features/workspaces/data/workspace-repository";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("ordered workflow execution", () => {
  let client: ReturnType<typeof postgres>;
  let server: http.Server;
  let baseUrl: string;
  let tailRequests = 0;

  beforeAll(async () => {
    client = postgres(databaseUrl as string, { max: 1, prepare: false });
    server = http.createServer((request, response) => {
      response.setHeader("Content-Type", "application/json");
      if (request.url === "/seed") {
        response.end(JSON.stringify({ token: "workflow-value", ok: true }));
        return;
      }
      if (request.url === "/consume/workflow-value") {
        response.end(JSON.stringify({ consumed: true }));
        return;
      }
      if (request.url === "/fail") {
        response.statusCode = 500;
        response.end(JSON.stringify({ ok: false }));
        return;
      }
      if (request.url === "/tail") {
        tailRequests += 1;
        response.end(JSON.stringify({ tail: true }));
        return;
      }
      if (request.url === "/slow") {
        setTimeout(() => {
          response.end(JSON.stringify({ late: true }));
        }, 250);
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ error: "not found" }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Mock workflow API did not start.");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(async () => {
    tailRequests = 0;
    await client`truncate table workspaces, application_settings restart identity cascade`;
  });

  afterAll(async () => {
    await closeDatabase();
    await client.end({ timeout: 5 });
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  async function project() {
    const workspace = await createWorkspace({
      name: "Workflow workspace",
      description: null,
    });
    return createProject({
      workspaceId: workspace.id,
      name: "Workflow project",
      description: null,
    });
  }

  async function request(input: {
    projectId: string;
    name: string;
    url: string;
    outputs?: Array<{
      name: string;
      jsonPath: string;
      expiresInJsonPath: string | null;
      secret: boolean;
    }>;
    assertions?: AssertionDefinition[];
  }) {
    const created = await createSavedRequest({
      projectId: input.projectId,
      folderId: null,
      name: input.name,
      method: "GET",
      url: input.url,
    });
    const detail = await getSavedRequestDetail(created.id);
    await updateSavedRequest({
      id: detail.id,
      authProfileId: detail.authProfileId,
      name: detail.name,
      description: detail.description,
      method: detail.method,
      url: detail.url,
      folderId: detail.folderId,
      tags: detail.tags,
      queryParameters: detail.queryParameters,
      headers: detail.headers,
      requestVariables: detail.requestVariables,
      outputDefinitions: input.outputs ?? [],
      assertions: input.assertions ?? [],
      body: detail.body,
      settings: { ...detail.settings, allowPrivateNetwork: true },
    });
    return created;
  }

  it("passes published outputs to later steps and persists assertions", async () => {
    const createdProject = await project();
    const seed = await request({
      projectId: createdProject.id,
      name: "Publish token",
      url: `${baseUrl}/seed`,
      outputs: [
        {
          name: "workflowToken",
          jsonPath: "$.token",
          expiresInJsonPath: null,
          secret: false,
        },
      ],
      assertions: [
        {
          name: "Seed succeeds",
          enabled: true,
          type: "status_equals",
          configuration: { expected: 200 },
        },
      ],
    });
    const consume = await request({
      projectId: createdProject.id,
      name: "Consume token",
      url: `${baseUrl}/consume/{{workflowToken}}`,
    });
    const saved = await saveWorkflow({
      projectId: createdProject.id,
      name: "Output handoff",
      description: "Publishes and consumes a generated value.",
      steps: [
        {
          requestId: seed.id,
          name: "Publish",
          failureMode: "stop",
          enabled: true,
          runtimeOverrides: [],
          assertions: [],
        },
        {
          requestId: consume.id,
          name: "Consume",
          failureMode: "stop",
          enabled: true,
          runtimeOverrides: [],
          assertions: [
            {
              name: "Value was consumed",
              enabled: true,
              type: "jsonpath_equals",
              configuration: {
                path: "$.consumed",
                expected: "true",
                mode: "text",
              },
            },
          ],
        },
      ],
    });

    const report = await runWorkflow({
      workflowId: saved.id,
      workflowRunId: crypto.randomUUID(),
      runtimeVariables: [],
      signal: new AbortController().signal,
    });

    expect(report.status).toBe("succeeded");
    expect(report.summary).toEqual({
      total: 2,
      attempted: 2,
      passed: 2,
      failed: 0,
      stoppedEarly: false,
    });
    expect(report.steps[0]?.outputNames).toEqual(["workflowToken"]);
    expect(report.steps[1]?.execution?.resolvedUrl).toContain(
      "/consume/workflow-value",
    );
    expect(report.steps[1]?.assertionResults).toEqual([
      expect.objectContaining({
        name: "Value was consumed",
        owner: "workflow_step",
        passed: true,
      }),
    ]);
    expect((await getWorkflowDetail(saved.id)).steps).toHaveLength(2);

    const projectCopy = await duplicateProject(createdProject.id);
    const copiedWorkflow = (await listWorkflows(projectCopy.id))[0];
    expect(copiedWorkflow?.name).toBe("Output handoff");
    const copiedDetail = await getWorkflowDetail(copiedWorkflow!.id);
    expect(copiedDetail.steps).toHaveLength(2);
    expect(copiedDetail.steps[0]?.requestId).not.toBe(seed.id);
    expect(copiedDetail.steps[1]?.assertions[0]?.name).toBe(
      "Value was consumed",
    );
  });

  it("stops or continues after assertion failure according to the step", async () => {
    const createdProject = await project();
    const failing = await request({
      projectId: createdProject.id,
      name: "Fail assertion",
      url: `${baseUrl}/fail`,
      assertions: [
        {
          name: "Must be OK",
          enabled: true,
          type: "status_equals",
          configuration: { expected: 200 },
        },
      ],
    });
    const tail = await request({
      projectId: createdProject.id,
      name: "Tail request",
      url: `${baseUrl}/tail`,
    });
    const steps = (failureMode: "stop" | "continue") => [
      {
        requestId: failing.id,
        name: "Fail",
        failureMode,
        enabled: true,
        runtimeOverrides: [],
        assertions: [],
      },
      {
        requestId: tail.id,
        name: "Tail",
        failureMode: "stop" as const,
        enabled: true,
        runtimeOverrides: [],
        assertions: [],
      },
    ];
    const stopped = await saveWorkflow({
      projectId: createdProject.id,
      name: "Stop on failure",
      description: "",
      steps: steps("stop"),
    });
    const stoppedReport = await runWorkflow({
      workflowId: stopped.id,
      workflowRunId: crypto.randomUUID(),
      signal: new AbortController().signal,
    });
    expect(stoppedReport.status).toBe("failed");
    expect(stoppedReport.summary).toMatchObject({
      attempted: 1,
      failed: 1,
      stoppedEarly: true,
    });
    expect(tailRequests).toBe(0);

    const continued = await saveWorkflow({
      projectId: createdProject.id,
      name: "Continue on failure",
      description: "",
      steps: steps("continue"),
    });
    const continuedReport = await runWorkflow({
      workflowId: continued.id,
      workflowRunId: crypto.randomUUID(),
      signal: new AbortController().signal,
    });
    expect(continuedReport.status).toBe("failed");
    expect(continuedReport.summary).toMatchObject({
      attempted: 2,
      passed: 1,
      failed: 1,
      stoppedEarly: false,
    });
    expect(tailRequests).toBe(1);
  });

  it("persists a cancelled workflow and step report", async () => {
    const createdProject = await project();
    const slow = await request({
      projectId: createdProject.id,
      name: "Slow request",
      url: `${baseUrl}/slow`,
    });
    const workflow = await saveWorkflow({
      projectId: createdProject.id,
      name: "Cancelled workflow",
      description: "",
      steps: [
        {
          requestId: slow.id,
          name: "Wait",
          failureMode: "continue",
          enabled: true,
          runtimeOverrides: [],
          assertions: [],
        },
      ],
    });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);

    const report = await runWorkflow({
      workflowId: workflow.id,
      workflowRunId: crypto.randomUUID(),
      signal: controller.signal,
    });

    expect(report.status).toBe("cancelled");
    expect(report.steps[0]).toMatchObject({
      status: "cancelled",
      error: { code: "REQUEST_CANCELLED" },
    });
  });
});
