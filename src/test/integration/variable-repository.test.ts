import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closeDatabase } from "@/db/client";
import {
  createSavedRequest,
  getSavedRequestDetail,
  updateSavedRequest,
} from "@/features/requests/data/request-repository";
import {
  createEnvironment,
  deleteEnvironment,
  duplicateEnvironment,
  getVariableConfiguration,
  getVariableDefinitionsForRequest,
  saveVariableScope,
} from "@/features/variables/data/variable-repository";
import {
  createVariableResolver,
  type VariableValue,
} from "@/features/variables/domain";
import {
  createProject,
  createWorkspace,
  duplicateProject,
  duplicateWorkspace,
  getWorkbenchNavigation,
} from "@/features/workspaces/data/workspace-repository";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("environment and variable repository", () => {
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
    const request = await createSavedRequest({
      projectId: project.id,
      folderId: null,
      name: "Get fact",
      method: "GET",
      url: "{{baseUrl}}/facts/{{factId}}",
    });
    return { workspace, project, request };
  }

  function values(
    ...items: Array<[string, string, boolean?]>
  ): VariableValue[] {
    return items.map(([name, value, secret = false]) => ({
      name,
      value,
      secret,
      enabled: true,
    }));
  }

  async function save(
    scope:
      | "workspace"
      | "workspace_environment"
      | "project"
      | "project_environment"
      | "request",
    owner: Partial<{
      workspaceId: string;
      projectId: string;
      environmentId: string;
      requestId: string;
    }>,
    scopedValues: VariableValue[],
  ) {
    await saveVariableScope({
      scope,
      workspaceId: owner.workspaceId ?? null,
      projectId: owner.projectId ?? null,
      environmentId: owner.environmentId ?? null,
      requestId: owner.requestId ?? null,
      variables: scopedValues,
    });
  }

  it("resolves every scope in documented precedence and masks nested secrets", async () => {
    const { workspace, project, request } = await hierarchy();
    const workspaceEnvironment = await createEnvironment({
      workspaceId: workspace.id,
      projectId: null,
      name: "Shared Test",
      description: null,
    });
    const projectEnvironment = await createEnvironment({
      workspaceId: workspace.id,
      projectId: project.id,
      name: "Project Test",
      description: null,
    });
    await save(
      "workspace",
      { workspaceId: workspace.id },
      values(["baseUrl", "https://workspace.test"]),
    );
    await save(
      "workspace_environment",
      { environmentId: workspaceEnvironment.id },
      values(["baseUrl", "https://workspace-env.test"]),
    );
    await save(
      "project",
      { projectId: project.id },
      values(["baseUrl", "https://project.test"]),
    );
    await save(
      "project_environment",
      { environmentId: projectEnvironment.id },
      values(
        ["baseUrl", "https://project-env.test"],
        ["token", "database-secret", true],
      ),
    );
    await save(
      "request",
      { requestId: request.id },
      values(["factId", "42"], ["authorization", "Bearer {{token}}"]),
    );

    const definitions = await getVariableDefinitionsForRequest({
      requestId: request.id,
      workspaceEnvironmentId: workspaceEnvironment.id,
      projectEnvironmentId: projectEnvironment.id,
      runtimeVariables: values(["baseUrl", "https://runtime.test"]),
    });
    const resolver = createVariableResolver(definitions);
    expect(resolver.interpolate("{{baseUrl}}/facts/{{factId}}")).toMatchObject({
      value: "https://runtime.test/facts/42",
      unresolved: [],
    });
    expect(resolver.interpolate("{{authorization}}")).toMatchObject({
      value: "Bearer database-secret",
      preview: "••••••••",
      secret: true,
    });

    const configuration = await getVariableConfiguration({
      workspaceId: workspace.id,
      projectId: project.id,
    });
    expect(configuration).toMatchObject({
      workspaceVariables: [{ name: "baseUrl" }],
      workspaceEnvironments: [
        { name: "Shared Test", variables: [{ name: "baseUrl" }] },
      ],
      projectVariables: [{ name: "baseUrl" }],
      projectEnvironments: [
        {
          name: "Project Test",
          variables: expect.arrayContaining([
            expect.objectContaining({ name: "token", secret: true }),
          ]),
        },
      ],
    });

    const copy = await duplicateEnvironment(projectEnvironment.id);
    const copiedConfiguration = await getVariableConfiguration({
      workspaceId: workspace.id,
      projectId: project.id,
    });
    expect(
      copiedConfiguration.projectEnvironments.find(({ id }) => id === copy.id),
    ).toMatchObject({
      name: "Project Test copy",
      variables: expect.arrayContaining([
        expect.objectContaining({ name: "token", value: "database-secret" }),
      ]),
    });
  });

  it("validates selections and cleans deleted selections from requests", async () => {
    const { workspace, project, request } = await hierarchy();
    const environment = await createEnvironment({
      workspaceId: workspace.id,
      projectId: project.id,
      name: "Local",
      description: null,
    });
    const otherProject = await createProject({
      workspaceId: workspace.id,
      name: "Other API",
      description: null,
    });
    const otherEnvironment = await createEnvironment({
      workspaceId: workspace.id,
      projectId: otherProject.id,
      name: "Other",
      description: null,
    });
    await expect(
      getVariableDefinitionsForRequest({
        requestId: request.id,
        projectEnvironmentId: otherEnvironment.id,
      }),
    ).rejects.toMatchObject({
      code: "ENVIRONMENT_SELECTION_INVALID",
    });

    const detail = await getSavedRequestDetail(request.id);
    await updateSavedRequest({
      id: detail.id,
      name: detail.name,
      description: detail.description,
      method: detail.method,
      url: detail.url,
      folderId: detail.folderId,
      tags: detail.tags,
      queryParameters: detail.queryParameters,
      headers: detail.headers,
      requestVariables: [],
      body: detail.body,
      settings: { ...detail.settings, projectEnvironmentId: environment.id },
    });
    expect(
      (await getSavedRequestDetail(request.id)).settings.projectEnvironmentId,
    ).toBe(environment.id);
    await deleteEnvironment(environment.id);
    expect(
      (await getSavedRequestDetail(request.id)).settings.projectEnvironmentId,
    ).toBeUndefined();
  });

  it("deep-copies variable scopes, environments, selections, and request variables", async () => {
    const { workspace, project, request } = await hierarchy();
    const workspaceEnvironment = await createEnvironment({
      workspaceId: workspace.id,
      projectId: null,
      name: "Shared",
      description: null,
    });
    const projectEnvironment = await createEnvironment({
      workspaceId: workspace.id,
      projectId: project.id,
      name: "Local",
      description: null,
    });
    await save(
      "workspace",
      { workspaceId: workspace.id },
      values(["workspaceValue", "one"]),
    );
    await save(
      "workspace_environment",
      { environmentId: workspaceEnvironment.id },
      values(["sharedValue", "two"]),
    );
    await save(
      "project",
      { projectId: project.id },
      values(["projectValue", "three"]),
    );
    await save(
      "project_environment",
      { environmentId: projectEnvironment.id },
      values(["localValue", "four"]),
    );
    const detail = await getSavedRequestDetail(request.id);
    await updateSavedRequest({
      id: detail.id,
      name: detail.name,
      description: detail.description,
      method: detail.method,
      url: detail.url,
      folderId: detail.folderId,
      tags: detail.tags,
      queryParameters: detail.queryParameters,
      headers: detail.headers,
      requestVariables: values(["factId", "99"]),
      body: detail.body,
      settings: {
        ...detail.settings,
        workspaceEnvironmentId: workspaceEnvironment.id,
        projectEnvironmentId: projectEnvironment.id,
      },
    });

    await duplicateProject(project.id);
    const projectCopy = (await getWorkbenchNavigation()).workspaces[0]
      ?.projects[1];
    expect(projectCopy).toBeDefined();
    const projectRequest = await getSavedRequestDetail(
      projectCopy!.requests[0]!.id,
    );
    expect(projectRequest.requestVariables).toEqual([
      expect.objectContaining({ name: "factId", value: "99" }),
    ]);
    expect(projectRequest.settings.workspaceEnvironmentId).toBe(
      workspaceEnvironment.id,
    );
    expect(projectRequest.settings.projectEnvironmentId).not.toBe(
      projectEnvironment.id,
    );

    await duplicateWorkspace(workspace.id);
    const navigation = await getWorkbenchNavigation();
    const workspaceCopy = navigation.workspaces.find(({ name }) =>
      name.startsWith("Work copy"),
    );
    expect(workspaceCopy).toBeDefined();
    const copiedConfiguration = await getVariableConfiguration({
      workspaceId: workspaceCopy!.id,
      projectId: workspaceCopy!.projects[0]!.id,
    });
    expect(copiedConfiguration.workspaceVariables).toEqual([
      expect.objectContaining({ name: "workspaceValue", value: "one" }),
    ]);
    expect(copiedConfiguration.projectVariables).toEqual([
      expect.objectContaining({ name: "projectValue", value: "three" }),
    ]);
    const workspaceRequest = await getSavedRequestDetail(
      workspaceCopy!.projects[0]!.requests[0]!.id,
    );
    expect(workspaceRequest.settings.workspaceEnvironmentId).not.toBe(
      workspaceEnvironment.id,
    );
    expect(workspaceRequest.settings.projectEnvironmentId).not.toBe(
      projectEnvironment.id,
    );
  });
});
