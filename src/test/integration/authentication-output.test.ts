import http from "node:http";

import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closeDatabase } from "@/db/client";
import {
  getAuthConfiguration,
  getEffectiveAuthProfile,
  saveAuthOverride,
  saveAuthProfile,
} from "@/features/authentication/data/auth-repository";
import {
  AUTH_SECRET_PLACEHOLDER,
  defaultAuthConfiguration,
} from "@/features/authentication/domain";
import {
  createSavedRequest,
  getSavedRequestDetail,
  updateSavedRequest,
} from "@/features/requests/data/request-repository";
import { executeSavedRequest } from "@/features/requests/execution/request-executor";
import {
  createProject,
  createWorkspace,
  duplicateProject,
  duplicateWorkspace,
  getWorkbenchNavigation,
} from "@/features/workspaces/data/workspace-repository";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("authentication and request outputs", () => {
  let client: ReturnType<typeof postgres>;
  let server: http.Server;
  let baseUrl: string;
  let oauthRequests = 0;
  let oauthGrantBodies: string[] = [];
  let derivedTokenRequests = 0;

  beforeAll(async () => {
    client = postgres(databaseUrl as string, { max: 1, prepare: false });
    server = http.createServer((request, response) => {
      if (request.url === "/oauth/token") {
        oauthRequests += 1;
        let body = "";
        request.on("data", (chunk: Buffer) => {
          body += chunk.toString("utf8");
        });
        request.on("end", () => {
          oauthGrantBodies.push(body);
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(
            JSON.stringify({
              access_token: `oauth-access-secret-${oauthRequests}`,
              refresh_token: "oauth-refresh-secret",
              expires_in: 3_600,
              token_type: "Bearer",
            }),
          );
        });
        return;
      }
      if (request.url === "/derived-token") {
        derivedTokenRequests += 1;
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            access_token: "derived-access-secret",
            expires_in: 3_600,
          }),
        );
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          authorization: request.headers.authorization ?? null,
          entity: { id: 42 },
          url: request.url,
        }),
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Mock authentication API did not start.");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(async () => {
    oauthRequests = 0;
    oauthGrantBodies = [];
    derivedTokenRequests = 0;
    await client`truncate table workspaces, application_settings restart identity cascade`;
  });

  afterAll(async () => {
    await closeDatabase();
    await client.end({ timeout: 5 });
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  async function hierarchy() {
    const workspace = await createWorkspace({
      name: "Work",
      description: null,
    });
    const project = await createProject({
      workspaceId: workspace.id,
      name: "OAuth API",
      description: null,
    });
    return { workspace, project };
  }

  async function update(
    requestId: string,
    values: Partial<{
      authProfileId: string;
      url: string;
      outputDefinitions: Array<{
        name: string;
        jsonPath: string;
        expiresInJsonPath: string | null;
        secret: boolean;
      }>;
    }>,
  ) {
    const detail = await getSavedRequestDetail(requestId);
    await updateSavedRequest({
      id: detail.id,
      authProfileId: values.authProfileId ?? detail.authProfileId,
      name: detail.name,
      description: detail.description,
      method: detail.method,
      url: values.url ?? detail.url,
      folderId: detail.folderId,
      tags: detail.tags,
      queryParameters: detail.queryParameters,
      headers: detail.headers,
      requestVariables: detail.requestVariables,
      outputDefinitions: values.outputDefinitions ?? detail.outputDefinitions,
      body: detail.body,
      settings: { ...detail.settings, allowPrivateNetwork: true },
    });
  }

  async function execute(requestId: string) {
    return executeSavedRequest({
      requestId,
      executionId: crypto.randomUUID(),
      runtimeVariables: [],
      signal: new AbortController().signal,
    });
  }

  it("caches OAuth client-credentials tokens and publishes generated values", async () => {
    const { workspace, project } = await hierarchy();
    const profile = await saveAuthProfile({
      workspaceId: workspace.id,
      projectId: null,
      tokenRequestId: null,
      name: "Shared OAuth",
      type: "oauth2_client_credentials",
      configuration: {
        ...defaultAuthConfiguration(),
        tokenUrl: `${baseUrl}/oauth/token`,
        clientId: "workbench-client",
        clientSecret: "client-secret",
      },
    });
    const protectedRequest = await createSavedRequest({
      projectId: project.id,
      folderId: null,
      name: "Protected entity",
      method: "GET",
      url: `${baseUrl}/protected`,
    });
    await update(protectedRequest.id, {
      authProfileId: profile.id,
      outputDefinitions: [
        {
          name: "entityId",
          jsonPath: "$.entity.id",
          expiresInJsonPath: null,
          secret: false,
        },
        {
          name: "reflectedAuthorization",
          jsonPath: "$.authorization",
          expiresInJsonPath: null,
          secret: true,
        },
      ],
    });

    const first = await execute(protectedRequest.id);
    const second = await execute(protectedRequest.id);
    expect(first.status).toBe("succeeded");
    expect(second.status).toBe("succeeded");
    expect(oauthRequests).toBe(1);
    expect(first.outputs).toEqual([
      expect.objectContaining({ name: "entityId", value: "42" }),
    ]);
    expect(first.outputs).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "reflectedAuthorization" }),
      ]),
    );
    expect(JSON.stringify(first)).not.toContain("oauth-access-secret");
    expect(first.response?.bodyPreview).toContain("••••••••");

    await client`
      update auth_token_cache
      set expires_at = now() - interval '1 minute'
      where auth_profile_id = ${profile.id}::uuid
    `;
    expect((await execute(protectedRequest.id)).status).toBe("succeeded");
    expect(oauthRequests).toBe(2);
    expect(oauthGrantBodies[1]).toContain("grant_type=refresh_token");
    expect(oauthGrantBodies[1]).toContain("refresh_token=oauth-refresh-secret");

    const dependent = await createSavedRequest({
      projectId: project.id,
      folderId: null,
      name: "Dependent entity",
      method: "GET",
      url: `${baseUrl}/entities/{{entityId}}`,
    });
    await update(dependent.id, {});
    const dependentExecution = await execute(dependent.id);
    expect(dependentExecution.status).toBe("succeeded");
    expect(dependentExecution.resolvedUrl).toContain("/entities/42");
  });

  it("runs a saved token request once and reuses its secret output", async () => {
    const { project } = await hierarchy();
    const tokenRequest = await createSavedRequest({
      projectId: project.id,
      folderId: null,
      name: "Generate token",
      method: "POST",
      url: `${baseUrl}/derived-token`,
    });
    await update(tokenRequest.id, {
      outputDefinitions: [
        {
          name: "accessToken",
          jsonPath: "$.access_token",
          expiresInJsonPath: "$.expires_in",
          secret: true,
        },
      ],
    });
    const profile = await saveAuthProfile({
      workspaceId: null,
      projectId: project.id,
      tokenRequestId: tokenRequest.id,
      name: "Request-derived OAuth",
      type: "request_derived",
      configuration: defaultAuthConfiguration(),
    });
    const protectedRequest = await createSavedRequest({
      projectId: project.id,
      folderId: null,
      name: "Derived protected request",
      method: "GET",
      url: `${baseUrl}/protected`,
    });
    await update(protectedRequest.id, { authProfileId: profile.id });

    const first = await execute(protectedRequest.id);
    const second = await execute(protectedRequest.id);
    expect(first.status).toBe("succeeded");
    expect(second.status).toBe("succeeded");
    expect(derivedTokenRequests).toBe(1);
    expect(JSON.stringify(first)).not.toContain("derived-access-secret");
    const tokenHistory = (await getSavedRequestDetail(tokenRequest.id)).history;
    expect(tokenHistory[0]?.outputs[0]).toMatchObject({
      name: "accessToken",
      value: "••••••••",
      secret: true,
    });
    expect(tokenHistory[0]?.response?.bodyPreview).not.toContain(
      "derived-access-secret",
    );
  });

  it("deep-copies profile references, token requests, and output definitions", async () => {
    const { workspace, project } = await hierarchy();
    const tokenRequest = await createSavedRequest({
      projectId: project.id,
      folderId: null,
      name: "Copy token",
      method: "POST",
      url: `${baseUrl}/derived-token`,
    });
    await update(tokenRequest.id, {
      outputDefinitions: [
        {
          name: "accessToken",
          jsonPath: "$.access_token",
          expiresInJsonPath: "$.expires_in",
          secret: true,
        },
      ],
    });
    const profile = await saveAuthProfile({
      workspaceId: null,
      projectId: project.id,
      tokenRequestId: tokenRequest.id,
      name: "Copy derived auth",
      type: "request_derived",
      configuration: defaultAuthConfiguration(),
    });
    const dependent = await createSavedRequest({
      projectId: project.id,
      folderId: null,
      name: "Copy protected",
      method: "GET",
      url: `${baseUrl}/protected`,
    });
    await update(dependent.id, { authProfileId: profile.id });

    await duplicateProject(project.id);
    let navigation = await getWorkbenchNavigation();
    const projectCopy = navigation.workspaces[0]?.projects.find(
      ({ name }) => name === "OAuth API copy",
    );
    expect(projectCopy).toBeDefined();
    const copiedToken = projectCopy?.requests.find(
      ({ name }) => name === "Copy token",
    );
    const copiedDependent = projectCopy?.requests.find(
      ({ name }) => name === "Copy protected",
    );
    const copiedAuth = await getAuthConfiguration({
      workspaceId: workspace.id,
      projectId: projectCopy!.id,
    });
    const copiedProfile = copiedAuth.profiles.find(
      ({ name }) => name === "Copy derived auth",
    );
    expect(copiedProfile).toMatchObject({
      projectId: projectCopy!.id,
      tokenRequestId: copiedToken!.id,
    });
    expect(await getSavedRequestDetail(copiedDependent!.id)).toMatchObject({
      authProfileId: copiedProfile!.id,
    });
    expect(
      (await getSavedRequestDetail(copiedToken!.id)).outputDefinitions,
    ).toEqual([expect.objectContaining({ name: "accessToken", secret: true })]);

    await duplicateWorkspace(workspace.id);
    navigation = await getWorkbenchNavigation();
    const workspaceCopy = navigation.workspaces.find(
      ({ name }) => name === "Work copy",
    );
    const copiedOriginalProject = workspaceCopy?.projects.find(
      ({ name }) => name === "OAuth API",
    );
    expect(copiedOriginalProject).toBeDefined();
    const workspaceToken = copiedOriginalProject?.requests.find(
      ({ name }) => name === "Copy token",
    );
    const workspaceAuth = await getAuthConfiguration({
      workspaceId: workspaceCopy!.id,
      projectId: copiedOriginalProject!.id,
    });
    expect(
      workspaceAuth.profiles.find(({ name }) => name === "Copy derived auth"),
    ).toMatchObject({ tokenRequestId: workspaceToken!.id });
  });

  it("preserves secret overrides and isolates inherited caches per project", async () => {
    const { workspace, project } = await hierarchy();
    const secondProject = await createProject({
      workspaceId: workspace.id,
      name: "Second OAuth API",
      description: null,
    });
    const profile = await saveAuthProfile({
      workspaceId: workspace.id,
      projectId: null,
      tokenRequestId: null,
      name: "Overridden OAuth",
      type: "oauth2_client_credentials",
      configuration: {
        ...defaultAuthConfiguration(),
        tokenUrl: `${baseUrl}/oauth/token`,
        clientId: "base-client",
        clientSecret: "base-secret",
      },
    });
    await saveAuthOverride({
      authProfileId: profile.id,
      projectId: project.id,
      configuration: {
        clientId: "project-client",
        clientSecret: "project-secret",
      },
    });
    await saveAuthOverride({
      authProfileId: profile.id,
      projectId: project.id,
      configuration: {
        audience: "project-audience",
        clientSecret: AUTH_SECRET_PLACEHOLDER,
      },
    });
    expect(await getEffectiveAuthProfile(profile.id, project.id)).toMatchObject(
      {
        configuration: {
          clientId: "project-client",
          clientSecret: "project-secret",
          audience: "project-audience",
        },
      },
    );
    expect(
      await getEffectiveAuthProfile(profile.id, secondProject.id),
    ).toMatchObject({
      configuration: {
        clientId: "base-client",
        clientSecret: "base-secret",
      },
    });

    for (const [owner, name] of [
      [project, "First inherited cache"],
      [secondProject, "Second inherited cache"],
    ] as const) {
      const saved = await createSavedRequest({
        projectId: owner.id,
        folderId: null,
        name,
        method: "GET",
        url: `${baseUrl}/protected`,
      });
      await update(saved.id, { authProfileId: profile.id });
      expect((await execute(saved.id)).status).toBe("succeeded");
      expect((await execute(saved.id)).status).toBe("succeeded");
    }
    expect(oauthRequests).toBe(2);
    expect(oauthGrantBodies).toEqual(
      expect.arrayContaining([
        expect.stringContaining("client_id=project-client"),
        expect.stringContaining("client_id=base-client"),
      ]),
    );
  });
});
