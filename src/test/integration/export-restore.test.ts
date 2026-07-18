import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { count, eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closeDatabase, getDatabase } from "@/db/client";
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
  createExportArchive,
  parseExportArchive,
} from "@/features/exports/archive";
import {
  createBackup,
  getBackupDirectory,
  listBackups,
} from "@/features/exports/backup-service";
import {
  collectExportScope,
  restoreExportArchive,
} from "@/features/exports/data/export-repository";
import { saveDataRetentionSettings } from "@/features/exports/data/settings-repository";
import {
  createExecutionRecord,
  failExecution,
} from "@/features/requests/data/request-repository";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

interface Seed {
  workspaceId: string;
  projectId: string;
  requestId: string;
}

databaseDescribe("versioned export and restore", () => {
  let client: ReturnType<typeof postgres>;
  let backupDirectory: string;

  beforeAll(async () => {
    client = postgres(databaseUrl as string, { max: 1, prepare: false });
    backupDirectory = await mkdtemp(
      path.join(tmpdir(), "workbench-backup-test-"),
    );
    process.env.WORKBENCH_BACKUP_DIR = backupDirectory;
  });

  beforeEach(async () => {
    await client`truncate table workspaces, application_settings restart identity cascade`;
  });

  afterAll(async () => {
    await closeDatabase();
    await client.end({ timeout: 5 });
    await rm(backupDirectory, { recursive: true, force: true });
    delete process.env.WORKBENCH_BACKUP_DIR;
  });

  async function seed(): Promise<Seed> {
    const database = getDatabase();
    const workspaceId = randomUUID();
    const projectId = randomUUID();
    const folderId = randomUUID();
    const requestId = randomUUID();
    const environmentId = randomUUID();
    const authProfileId = randomUUID();
    const outputDefinitionId = randomUUID();
    const definitionId = randomUUID();
    const executionId = randomUUID();
    const workflowId = randomUUID();
    const workflowStepId = randomUUID();
    const workflowRunId = randomUUID();

    await database.insert(workspaces).values([
      { id: workspaceId, name: "Portable", position: 0 },
      { id: randomUUID(), name: "Outside", position: 1 },
    ]);
    await database.insert(projects).values({
      id: projectId,
      workspaceId,
      name: "Core API",
      position: 0,
    });
    await database.insert(folders).values({
      id: folderId,
      projectId,
      parentId: null,
      name: "Facts",
      position: 0,
    });
    await database.insert(environments).values({
      id: environmentId,
      workspaceId,
      projectId,
      name: "Local",
    });
    await database.insert(savedRequests).values({
      id: requestId,
      projectId,
      folderId,
      name: "Protected fact",
      method: "GET",
      url: "https://example.test/fact",
      position: 0,
      settings: { projectEnvironmentId: environmentId },
    });
    await database.insert(variables).values({
      id: randomUUID(),
      projectId,
      environmentId,
      scope: "project_environment",
      name: "accessToken",
      value: "variable-secret",
      secret: true,
    });
    await database.insert(requestHeaders).values({
      id: randomUUID(),
      requestId,
      name: "Authorization",
      value: "Bearer header-secret",
      enabled: true,
      secret: true,
      position: 0,
    });
    await database.insert(requestQueryParameters).values({
      id: randomUUID(),
      requestId,
      name: "format",
      value: "json",
      position: 0,
    });
    await database.insert(requestBodies).values({
      id: randomUUID(),
      requestId,
      type: "none",
    });
    await database.insert(requestOutputDefinitions).values({
      id: outputDefinitionId,
      requestId,
      name: "nextToken",
      jsonPath: "$.token",
      secret: true,
      position: 0,
    });
    await database.insert(authProfiles).values({
      id: authProfileId,
      projectId,
      tokenRequestId: requestId,
      name: "Bearer",
      type: "bearer",
      configuration: { token: "profile-secret" },
    });
    await database
      .update(savedRequests)
      .set({ authProfileId })
      .where(eq(savedRequests.id, requestId));
    await database.insert(authProfileOverrides).values({
      id: randomUUID(),
      authProfileId,
      projectId,
      configuration: { token: "override-secret" },
    });
    await database.insert(authTokenCache).values({
      id: randomUUID(),
      authProfileId,
      projectId,
      accessToken: "cached-secret",
      refreshToken: "refresh-secret",
    });
    await database.insert(importedDefinitions).values({
      id: definitionId,
      projectId,
      name: "Imported API",
      format: "openapi_json",
      sourceType: "file",
      originalDocument: '{"token":"source-secret"}',
      sourceHash: "hash",
    });
    await database.insert(importedOperations).values({
      id: randomUUID(),
      definitionId,
      sourceKey: "get:/fact",
      method: "GET",
      path: "/fact",
      operation: {},
      requestId,
    });
    await database.insert(importRuns).values({
      id: randomUUID(),
      definitionId,
      projectId,
      format: "openapi_json",
      status: "completed",
      sourceDocument: '{"token":"run-secret"}',
    });
    await database.insert(requestExecutions).values({
      id: executionId,
      projectId,
      requestId,
      status: "succeeded",
      method: "GET",
      resolvedUrl: "https://example.test/fact",
      requestSnapshot: { authorization: "snapshot-secret" },
    });
    await database.insert(responseMetadata).values({
      id: randomUUID(),
      executionId,
      statusCode: 200,
      headers: [{ name: "x-token", value: "response-secret" }],
      bodyPreview: '{"token":"body-secret"}',
    });
    await database.insert(runtimeOutputs).values({
      id: randomUUID(),
      definitionId: outputDefinitionId,
      executionId,
      value: "runtime-secret",
      secret: true,
    });
    await database.insert(workflows).values({
      id: workflowId,
      projectId,
      name: "Check fact",
    });
    await database.insert(workflowSteps).values({
      id: workflowStepId,
      workflowId,
      requestId,
      name: "Fact",
      position: 0,
      failureMode: "stop",
      runtimeOverrides: [
        {
          name: "temporary",
          value: "override-value",
          secret: true,
          enabled: true,
        },
      ],
    });
    await database.insert(assertions).values([
      {
        id: randomUUID(),
        requestId,
        name: "Status",
        type: "status_equals",
        configuration: { expected: 200 },
      },
      {
        id: randomUUID(),
        workflowStepId,
        name: "Fast",
        type: "duration_below",
        configuration: { maximumMs: 500 },
      },
    ]);
    await database.insert(workflowRuns).values({
      id: workflowRunId,
      workflowId,
      projectId,
      workflowName: "Check fact",
      status: "succeeded",
    });
    await database.insert(workflowStepRuns).values({
      id: randomUUID(),
      workflowRunId,
      workflowStepId,
      requestId,
      requestExecutionId: executionId,
      position: 0,
      name: "Fact",
      status: "succeeded",
      failureMode: "stop",
    });
    await database.insert(applicationSettings).values({
      id: randomUUID(),
      key: "navigation.activeWorkspaceId",
      value: workspaceId,
    });
    return { workspaceId, projectId, requestId };
  }

  it("imports an encrypted workspace with remapped relationships and no cross-scope data", async () => {
    const source = await seed();
    const scope = await collectExportScope("workspace", source.workspaceId);
    expect(scope.tables.workspaces).toHaveLength(1);
    expect(scope.tables.workspaces[0]?.name).toBe("Portable");
    const { archive } = await createExportArchive({
      ...scope,
      kind: "workspace",
      secretMode: "encrypted",
      password: "correct horse battery staple",
    });
    const parsed = await parseExportArchive(
      archive,
      "correct horse battery staple",
    );
    const restored = await restoreExportArchive({
      ...parsed,
      targetWorkspaceId: null,
    });

    expect(restored).toMatchObject({
      kind: "workspace",
      name: "Portable copy",
    });
    const [imported] = await getDatabase()
      .select()
      .from(workspaces)
      .where(eq(workspaces.name, "Portable copy"));
    expect(imported?.id).not.toBe(source.workspaceId);
    const [importedProject] = await getDatabase()
      .select()
      .from(projects)
      .where(eq(projects.workspaceId, imported?.id as string));
    const [importedVariable] = await getDatabase()
      .select()
      .from(variables)
      .where(eq(variables.projectId, importedProject?.id as string));
    expect(importedVariable?.value).toBe("variable-secret");
    const [importedRequest] = await getDatabase()
      .select({ id: savedRequests.id })
      .from(savedRequests)
      .where(eq(savedRequests.projectId, importedProject?.id as string))
      .limit(1);
    const [importedStep] = await getDatabase()
      .select()
      .from(workflowSteps)
      .where(eq(workflowSteps.requestId, importedRequest?.id as string));
    expect(importedStep?.workflowId).toBeTruthy();
  });

  it("imports a project into a chosen workspace", async () => {
    const source = await seed();
    const targetWorkspaceId = randomUUID();
    await getDatabase().insert(workspaces).values({
      id: targetWorkspaceId,
      name: "Destination",
      position: 2,
    });
    const scope = await collectExportScope("project", source.projectId);
    const { archive } = await createExportArchive({
      ...scope,
      kind: "project",
      secretMode: "exclude",
    });
    const parsed = await parseExportArchive(archive);
    await restoreExportArchive({
      ...parsed,
      targetWorkspaceId,
    });

    const [imported] = await getDatabase()
      .select()
      .from(projects)
      .where(eq(projects.workspaceId, targetWorkspaceId));
    expect(imported?.name).toBe("Core API copy");
    const [secret] = await getDatabase()
      .select()
      .from(variables)
      .where(eq(variables.projectId, imported?.id as string));
    expect(secret?.secret).toBe(true);
    expect(secret?.value).toBe("");
  });

  it("restores a full backup atomically and rolls back invalid data", async () => {
    await seed();
    const scope = await collectExportScope("full", null);
    const { archive } = await createExportArchive({
      ...scope,
      kind: "full",
      secretMode: "encrypted",
      password: "correct horse battery staple",
    });
    const parsed = await parseExportArchive(
      archive,
      "correct horse battery staple",
    );
    await getDatabase().insert(workspaces).values({
      id: randomUUID(),
      name: "Temporary",
      position: 9,
    });
    await restoreExportArchive({ ...parsed, targetWorkspaceId: null });
    const restoredNames = await getDatabase()
      .select({ name: workspaces.name })
      .from(workspaces);
    expect(restoredNames.map(({ name }) => name).sort()).toEqual([
      "Outside",
      "Portable",
    ]);

    const invalid = structuredClone(parsed);
    if (invalid.data.tables.projects[0]) {
      invalid.data.tables.projects[0].workspaceId = randomUUID();
    }
    await expect(
      restoreExportArchive({ ...invalid, targetWorkspaceId: null }),
    ).rejects.toBeTruthy();
    const afterFailure = await getDatabase()
      .select({ name: workspaces.name })
      .from(workspaces);
    expect(afterFailure.map(({ name }) => name).sort()).toEqual([
      "Outside",
      "Portable",
    ]);
  });

  it("applies the configured request history retention", async () => {
    const source = await seed();
    await saveDataRetentionSettings({ executionHistoryLimit: 10 });
    for (let index = 0; index < 12; index += 1) {
      const id = randomUUID();
      await createExecutionRecord({
        id,
        projectId: source.projectId,
        requestId: source.requestId,
        method: "GET",
        resolvedUrl: `https://example.test/${index}`,
        requestSnapshot: {},
      });
      await failExecution(id, { code: "TEST", message: "Expected" }, false);
    }
    const [result] = await getDatabase()
      .select({ value: count() })
      .from(requestExecutions)
      .where(eq(requestExecutions.projectId, source.projectId));
    expect(result?.value).toBe(10);
  });

  it("writes owner-only timestamped backups and prunes the oldest", async () => {
    await seed();
    for (const createdAt of [
      new Date("2026-07-18T10:00:00.000Z"),
      new Date("2026-07-18T11:00:00.000Z"),
      new Date("2026-07-18T12:00:00.000Z"),
    ]) {
      await createBackup({
        secretMode: "exclude",
        retentionCount: 2,
        createdAt,
      });
    }

    const backups = await listBackups();
    expect(backups.map(({ name }) => name)).toEqual([
      "workbench-backup-2026-07-18T12-00-00-000Z.zip",
      "workbench-backup-2026-07-18T11-00-00-000Z.zip",
    ]);
    const details = await stat(
      path.join(getBackupDirectory(), backups[0]!.name),
    );
    expect(details.mode & 0o777).toBe(0o600);
  });
});
