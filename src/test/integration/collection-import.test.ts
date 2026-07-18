import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closeDatabase } from "@/db/client";
import {
  executeCollectionImport,
  listCollectionImports,
  previewCollectionImport,
} from "@/features/imports/data/import-repository";
import { importCollectionSource } from "@/features/imports/registry";
import { listImportedDefinitions } from "@/features/openapi/data/openapi-repository";
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
const httpieDocument = readFileSync(
  fileURLToPath(
    new URL(
      "../../features/imports/fixtures/httpie-workspace.json",
      import.meta.url,
    ),
  ),
  "utf8",
);

databaseDescribe("collection import repository", () => {
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
      name: "Payments project",
      description: null,
    });
    return { workspace, project };
  }

  function execute(
    projectId: string,
    strategy: "rename" | "replace" | "merge" | "skip" = "rename",
    selectedRequestKeys?: string[],
  ) {
    const plan = importCollectionSource(httpieDocument);
    return executeCollectionImport({
      projectId,
      plan,
      approvedSourceHash: plan.sourceHash,
      sourceType: "file",
      originalDocument: httpieDocument,
      options: {
        definitionName: `HTTPie payments ${strategy}`,
        selectedRequestKeys:
          selectedRequestKeys ??
          plan.requests.map(({ sourceKey }) => sourceKey),
        includeEnvironments: true,
        includeProjectVariables: true,
        includeAuthProfiles: true,
        allowPrivateNetwork: false,
        conflictStrategy: strategy,
      },
    });
  }

  it("previews and persists a complete HTTPie workspace as executable requests", async () => {
    const { workspace, project } = await hierarchy();
    const plan = importCollectionSource(httpieDocument);
    const preview = await previewCollectionImport(project.id, plan);
    expect(preview).toMatchObject({
      format: "httpie",
      target: {
        workspaceId: workspace.id,
        workspaceName: "Work",
        projectId: project.id,
        projectName: "Payments project",
      },
      conflicts: [],
    });

    const result = await execute(project.id);
    expect(result).toMatchObject({
      createdFolders: 1,
      createdRequests: 2,
      createdEnvironments: 1,
      createdVariables: 2,
      createdAuthProfiles: 2,
    });
    expect(await listCollectionImports(project.id)).toEqual([
      expect.objectContaining({
        id: result.definitionId,
        format: "httpie",
        requestCount: 2,
        linkedRequestCount: 2,
      }),
    ]);
    await expect(listImportedDefinitions(project.id)).resolves.toEqual([]);

    const navigation = await getWorkbenchNavigation();
    const requests = navigation.workspaces[0]?.projects[0]?.requests ?? [];
    const list = requests.find(({ name }) => name === "List payments");
    const refund = requests.find(({ name }) => name === "Create refund");
    expect(list).toBeDefined();
    expect(refund).toBeDefined();
    await expect(getSavedRequestDetail(list!.id)).resolves.toMatchObject({
      method: "GET",
      url: "https://api.example.test/v1/payments",
      authProfileId: expect.any(String),
      queryParameters: [{ name: "status", value: "pending", enabled: true }],
      importSource: {
        definitionId: result.definitionId,
        sourceKey: "httpie:request-list-payments",
        customized: false,
      },
    });
    await expect(getSavedRequestDetail(refund!.id)).resolves.toMatchObject({
      url: "https://api.example.test/v1/payments/{{paymentId}}/refunds",
      requestVariables: [
        { name: "paymentId", value: "pay_123", enabled: true, secret: false },
      ],
      body: {
        type: "json",
        content: expect.stringContaining('"amount": 1250'),
      },
    });
    const environmentVariables = await client<
      Array<{
        environment: string;
        name: string;
        value: string;
        secret: boolean;
      }>
    >`
      select e.name as environment, v.name, v.value, v.secret
      from environments e
      join variables v on v.environment_id = e.id
      order by v.name
    `;
    expect(environmentVariables).toEqual([
      {
        environment: "Staging",
        name: "accessToken",
        value: "secret-token",
        secret: true,
      },
      {
        environment: "Staging",
        name: "baseUrl",
        value: "https://api.example.test",
        secret: false,
      },
    ]);
    const [stored] = await client<
      Array<{ source_key: string; operation: { sourceMetadata?: unknown } }>
    >`select source_key, operation from imported_operations where definition_id = ${result.definitionId} order by source_key limit 1`;
    expect(stored).toMatchObject({
      source_key: expect.stringContaining("httpie:"),
      operation: { sourceMetadata: expect.any(Object) },
    });
  });

  it("rejects execution when the source no longer matches its preview", async () => {
    const { project } = await hierarchy();
    const plan = importCollectionSource(httpieDocument);
    await expect(
      executeCollectionImport({
        projectId: project.id,
        plan,
        approvedSourceHash: "0".repeat(64),
        sourceType: "file",
        originalDocument: httpieDocument,
        options: {
          definitionName: "Stale import",
          selectedRequestKeys: plan.requests.map(({ sourceKey }) => sourceKey),
          includeEnvironments: true,
          includeProjectVariables: true,
          includeAuthProfiles: true,
          allowPrivateNetwork: false,
          conflictStrategy: "rename",
        },
      }),
    ).rejects.toThrow("changed after preview");
  });

  it.each(["rename", "replace", "merge", "skip"] as const)(
    "applies the %s request conflict strategy",
    async (strategy) => {
      const { project } = await hierarchy();
      const folder = await createFolder({
        projectId: project.id,
        parentId: null,
        name: "Payments",
      });
      const existing = await createSavedRequest({
        projectId: project.id,
        folderId: folder.id,
        name: "List payments",
        method: "GET",
        url: "https://custom.example.test/payments",
      });
      const detail = await getSavedRequestDetail(existing.id);
      await updateSavedRequest({
        ...detail,
        description: "Developer-owned request",
        headers: [
          {
            name: "X-Custom",
            value: "preserve-me",
            enabled: true,
            secret: false,
          },
        ],
      });
      const plan = importCollectionSource(httpieDocument);
      const sourceKey = plan.requests.find(
        ({ name }) => name === "List payments",
      )!.sourceKey;
      const preview = await previewCollectionImport(project.id, plan);
      expect(preview.conflicts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "folder", label: "Payments" }),
          expect.objectContaining({ kind: "request", label: "List payments" }),
        ]),
      );

      const result = await execute(project.id, strategy, [sourceKey]);
      const requests =
        (await getWorkbenchNavigation()).workspaces[0]?.projects[0]?.requests ??
        [];
      if (strategy === "rename") {
        expect(result).toMatchObject({ createdRequests: 1 });
        expect(requests).toHaveLength(2);
        expect((await getSavedRequestDetail(existing.id)).url).toBe(
          "https://custom.example.test/payments",
        );
      } else if (strategy === "replace") {
        expect(result).toMatchObject({
          replacedRequests: 1,
          createdRequests: 0,
        });
        expect(await getSavedRequestDetail(existing.id)).toMatchObject({
          url: "https://api.example.test/v1/payments",
          headers: [{ name: "Accept", value: "application/json" }],
          importSource: { definitionId: result.definitionId },
        });
      } else if (strategy === "merge") {
        expect(result).toMatchObject({ mergedRequests: 1, createdRequests: 0 });
        expect(await getSavedRequestDetail(existing.id)).toMatchObject({
          url: "https://api.example.test/v1/payments",
          headers: expect.arrayContaining([
            expect.objectContaining({ name: "X-Custom", value: "preserve-me" }),
            expect.objectContaining({
              name: "Accept",
              value: "application/json",
            }),
          ]),
          importSource: { definitionId: result.definitionId },
        });
      } else {
        expect(result).toMatchObject({
          skippedRequests: 1,
          createdRequests: 0,
        });
        expect(await getSavedRequestDetail(existing.id)).toMatchObject({
          url: "https://custom.example.test/payments",
          importSource: null,
        });
      }
    },
  );
});
