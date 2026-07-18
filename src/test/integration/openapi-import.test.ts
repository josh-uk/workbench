import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closeDatabase } from "@/db/client";
import {
  applyOpenApiRefresh,
  detachImportedRequest,
  executeOpenApiImport,
  listImportedDefinitions,
  previewOpenApiRefresh,
} from "@/features/openapi/data/openapi-repository";
import { parseOpenApiDocument } from "@/features/openapi/parser";
import {
  createSavedRequest,
  getSavedRequestDetail,
  updateSavedRequest,
} from "@/features/requests/data/request-repository";
import {
  createFolder,
  createProject,
  createWorkspace,
  getWorkbenchNavigation,
} from "@/features/workspaces/data/workspace-repository";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

function document(
  paths: Record<string, unknown>,
  server = "https://api.example.test/v1",
) {
  return JSON.stringify({
    openapi: "3.1.0",
    info: { title: "Facts API", version: "1.0.0" },
    servers: [{ url: server }],
    paths,
    components: {
      securitySchemes: {
        serviceKey: { type: "apiKey", in: "header", name: "X-API-Key" },
      },
      schemas: {
        Fact: {
          type: "object",
          properties: { id: { type: "string" }, text: { type: "string" } },
        },
      },
    },
  });
}

const initialDocument = document({
  "/facts/{id}": {
    get: {
      operationId: "getFact",
      summary: "Get a fact",
      tags: ["Facts"],
      security: [{ serviceKey: [] }],
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", example: "fact-1" },
        },
      ],
      responses: { "200": { description: "OK" } },
    },
  },
  "/facts": {
    post: {
      operationId: "createFact",
      summary: "Create a fact",
      tags: ["Facts"],
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: { text: { type: "string", example: "A fact" } },
            },
          },
        },
      },
      responses: { "201": { description: "Created" } },
    },
  },
});

databaseDescribe("OpenAPI import repository", () => {
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
      name: "Facts",
      description: null,
    });
    return { workspace, project };
  }

  async function importDefinition(projectId: string) {
    const parsed = parseOpenApiDocument(initialDocument);
    return executeOpenApiImport({
      projectId,
      parsed,
      source: {
        sourceType: "paste",
        sourceUrl: null,
        allowPrivateNetwork: false,
      },
      options: {
        name: "Facts API",
        selectedOperationKeys: parsed.operations.map(
          ({ sourceKey }) => sourceKey,
        ),
        tagFolders: { Facts: "Imported facts" },
        createServerVariable: true,
        serverVariableName: "factsBaseUrl",
        createAuthProfiles: true,
        conflictStrategy: "rename",
      },
    });
  }

  it("persists a first-class definition and complete executable requests", async () => {
    const { project } = await hierarchy();
    const result = await importDefinition(project.id);
    expect(result).toMatchObject({
      createdRequests: 2,
      createdFolders: 1,
      createdAuthProfiles: 1,
      serverVariableName: "factsBaseUrl",
    });

    const definitions = await listImportedDefinitions(project.id);
    expect(definitions).toEqual([
      expect.objectContaining({
        id: result.definitionId,
        operationCount: 2,
        linkedRequestCount: 2,
      }),
    ]);
    const navigation = await getWorkbenchNavigation();
    const requests = navigation.workspaces[0]?.projects[0]?.requests ?? [];
    const getRequest = requests.find(({ name }) => name === "Get a fact");
    const createRequest = requests.find(({ name }) => name === "Create a fact");
    expect(getRequest).toBeDefined();
    expect(createRequest).toBeDefined();

    await expect(getSavedRequestDetail(getRequest!.id)).resolves.toMatchObject({
      url: "{{factsBaseUrl}}/facts/{{id}}",
      authProfileId: expect.any(String),
      requestVariables: [{ name: "id", value: "fact-1" }],
      importSource: {
        definitionId: result.definitionId,
        sourceKey: "GET /facts/{id}",
        customized: false,
      },
    });
    await expect(
      getSavedRequestDetail(createRequest!.id),
    ).resolves.toMatchObject({
      body: {
        type: "json",
        content: expect.stringContaining('"text": "A fact"'),
      },
    });
    const [run] = await client<
      Array<{ status: string; source_document: string; source_hash: string }>
    >`select status, source_document, source_hash from import_runs where definition_id = ${result.definitionId}`;
    expect(run).toMatchObject({
      status: "completed",
      source_document: initialDocument,
      source_hash: expect.any(String),
    });
  });

  it("selectively refreshes operations while preserving customized requests", async () => {
    const { project } = await hierarchy();
    const imported = await importDefinition(project.id);
    const navigation = await getWorkbenchNavigation();
    const requests = navigation.workspaces[0]?.projects[0]?.requests ?? [];
    const customized = requests.find(({ name }) => name === "Get a fact")!;
    const original = await getSavedRequestDetail(customized.id);
    await updateSavedRequest({
      ...original,
      name: "My custom fact lookup",
      description: original.description ?? "",
    });

    const refreshedDocument = document(
      {
        "/facts/{id}": {
          get: {
            operationId: "getFact",
            summary: "Fetch one fact",
            tags: ["Facts"],
            parameters: [
              {
                name: "id",
                in: "path",
                required: true,
                schema: { type: "string", example: "fact-2" },
              },
            ],
            responses: { "200": { description: "Changed" } },
          },
        },
        "/facts/search": {
          post: {
            operationId: "searchFacts",
            summary: "Search facts",
            tags: ["Facts"],
            responses: { "200": { description: "Results" } },
          },
        },
      },
      "https://api.example.test/v2",
    );
    const parsed = parseOpenApiDocument(refreshedDocument);
    const preview = await previewOpenApiRefresh(imported.definitionId, parsed);
    expect(preview.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceKey: "GET /facts/{id}",
          category: "changed",
          customized: true,
        }),
        expect.objectContaining({
          sourceKey: "POST /facts",
          category: "removed",
        }),
        expect.objectContaining({
          sourceKey: "POST /facts/search",
          category: "added",
        }),
        expect.objectContaining({ category: "servers" }),
      ]),
    );

    const result = await applyOpenApiRefresh({
      definitionId: imported.definitionId,
      parsed,
      source: {
        sourceType: "paste",
        sourceUrl: null,
        allowPrivateNetwork: false,
      },
      selectedChangeKeys: preview.changes.map(({ key }) => key),
    });
    expect(result).toMatchObject({
      added: 1,
      updated: 1,
      removed: 1,
      preservedCustomRequests: 1,
    });
    expect(await getSavedRequestDetail(customized.id)).toMatchObject({
      name: "My custom fact lookup",
      url: "{{factsBaseUrl}}/facts/{{id}}",
      importSource: { customized: true },
    });
    const after = await getWorkbenchNavigation();
    const afterRequests = after.workspaces[0]?.projects[0]?.requests ?? [];
    expect(afterRequests.map(({ name }) => name)).toEqual(
      expect.arrayContaining(["My custom fact lookup", "Search facts"]),
    );
    expect(afterRequests.map(({ name }) => name)).not.toContain(
      "Create a fact",
    );
    const serverVariables = await client<
      Array<{ name: string; value: string }>
    >`select name, value from variables where scope = 'project' order by name`;
    expect(serverVariables).toEqual([
      { name: "factsBaseUrl", value: "https://api.example.test/v2" },
    ]);
  });

  it.each(["rename", "replace", "skip"] as const)(
    "applies the %s request conflict strategy without stealing another import link",
    async (conflictStrategy) => {
      const { project } = await hierarchy();
      const folder = await createFolder({
        projectId: project.id,
        parentId: null,
        name: "Facts",
      });
      const existing = await createSavedRequest({
        projectId: project.id,
        folderId: folder.id,
        name: "Get a fact",
        method: "GET",
        url: "https://custom.example.test/fact",
      });
      const parsed = parseOpenApiDocument(initialDocument);
      const result = await executeOpenApiImport({
        projectId: project.id,
        parsed,
        source: {
          sourceType: "paste",
          sourceUrl: null,
          allowPrivateNetwork: false,
        },
        options: {
          name: `Facts ${conflictStrategy}`,
          selectedOperationKeys: ["GET /facts/{id}"],
          tagFolders: { Facts: "Facts" },
          createServerVariable: false,
          serverVariableName: "baseUrl",
          createAuthProfiles: false,
          conflictStrategy,
        },
      });

      const definitions = await listImportedDefinitions(project.id);
      const requests =
        (await getWorkbenchNavigation()).workspaces[0]?.projects[0]?.requests ??
        [];
      if (conflictStrategy === "rename") {
        expect(result).toMatchObject({
          createdRequests: 1,
          replacedRequests: 0,
        });
        expect(requests).toHaveLength(2);
        expect(
          requests.filter(({ name }) => name === "Get a fact"),
        ).toHaveLength(1);
        expect(definitions[0]).toMatchObject({ linkedRequestCount: 1 });
      } else if (conflictStrategy === "replace") {
        expect(result).toMatchObject({
          createdRequests: 0,
          replacedRequests: 1,
        });
        expect(await getSavedRequestDetail(existing.id)).toMatchObject({
          url: "https://api.example.test/v1/facts/{{id}}",
          importSource: { definitionId: result.definitionId },
        });
      } else {
        expect(result).toMatchObject({
          createdRequests: 0,
          skippedRequests: 1,
        });
        expect(await getSavedRequestDetail(existing.id)).toMatchObject({
          url: "https://custom.example.test/fact",
          importSource: null,
        });
        expect(definitions[0]).toMatchObject({ linkedRequestCount: 0 });
      }
    },
  );

  it("preserves a server variable changed after import", async () => {
    const { project } = await hierarchy();
    const imported = await importDefinition(project.id);
    await client`
      update variables
      set value = 'https://developer.example.test'
      where project_id = ${project.id} and scope = 'project' and name = 'factsBaseUrl'
    `;
    const refreshedDocument = document(
      (JSON.parse(initialDocument) as { paths: Record<string, unknown> }).paths,
      "https://api.example.test/v2",
    );
    const parsed = parseOpenApiDocument(refreshedDocument);
    const preview = await previewOpenApiRefresh(imported.definitionId, parsed);
    const serverChange = preview.changes.find(({ key }) => key === "servers");
    expect(serverChange).toBeDefined();

    const result = await applyOpenApiRefresh({
      definitionId: imported.definitionId,
      parsed,
      source: {
        sourceType: "paste",
        sourceUrl: null,
        allowPrivateNetwork: false,
      },
      selectedChangeKeys: ["servers"],
    });
    expect(result.warnings).toContain(
      "Project variable factsBaseUrl was changed after import and was preserved.",
    );
    const [variable] = await client<
      Array<{ value: string }>
    >`select value from variables where project_id = ${project.id} and name = 'factsBaseUrl'`;
    expect(variable?.value).toBe("https://developer.example.test");
  });

  it("treats output definitions added in the editor as customization", async () => {
    const { project } = await hierarchy();
    const imported = await importDefinition(project.id);
    const navigation = await getWorkbenchNavigation();
    const request = navigation.workspaces[0]?.projects[0]?.requests.find(
      ({ name }) => name === "Get a fact",
    );
    expect(request).toBeDefined();
    const detail = await getSavedRequestDetail(request!.id);
    await updateSavedRequest({
      ...detail,
      description: detail.description ?? "",
      outputDefinitions: [
        {
          name: "factId",
          jsonPath: "$.id",
          expiresInJsonPath: null,
          secret: false,
        },
      ],
    });

    const nextDocument = JSON.parse(initialDocument) as {
      paths: Record<string, { get?: { summary?: string } }>;
    };
    nextDocument.paths["/facts/{id}"]!.get!.summary = "Fetch a fact";
    const preview = await previewOpenApiRefresh(
      imported.definitionId,
      parseOpenApiDocument(JSON.stringify(nextDocument)),
    );
    expect(preview.changes).toContainEqual(
      expect.objectContaining({
        sourceKey: "GET /facts/{id}",
        category: "changed",
        customized: true,
      }),
    );
  });

  it("detaches an imported request as custom without deleting either record", async () => {
    const { project } = await hierarchy();
    await importDefinition(project.id);
    const navigation = await getWorkbenchNavigation();
    const request = navigation.workspaces[0]?.projects[0]?.requests[0];
    expect(request).toBeDefined();

    await detachImportedRequest(request!.id);

    expect((await getSavedRequestDetail(request!.id)).importSource).toBeNull();
    const [operation] = await client<
      Array<{ request_id: string | null; customized: boolean }>
    >`select request_id, customized from imported_operations where customized = true limit 1`;
    expect(operation).toEqual({ request_id: null, customized: true });
  });
});
