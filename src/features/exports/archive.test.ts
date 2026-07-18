import { randomUUID } from "node:crypto";

import { strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  createExportArchive,
  mutateZipJson,
  parseExportArchive,
} from "@/features/exports/archive";
import {
  emptyArchiveTables,
  ExportDomainError,
  MAX_EXPORT_FILE_BYTES,
} from "@/features/exports/domain";

function tables() {
  const result = emptyArchiveTables();
  const workspaceId = randomUUID();
  const projectId = randomUUID();
  result.workspaces.push({
    id: workspaceId,
    name: "Portable",
    description: null,
    position: 0,
  });
  result.projects.push({
    id: projectId,
    workspaceId,
    name: "API",
    description: null,
    position: 0,
    archived: false,
  });
  result.variables.push({
    id: randomUUID(),
    workspaceId,
    projectId: null,
    environmentId: null,
    requestId: null,
    scope: "workspace",
    name: "token",
    value: "do-not-leak",
    secret: true,
    enabled: true,
  });
  const requestId = randomUUID();
  result.savedRequests.push({
    id: requestId,
    projectId,
    folderId: null,
    authProfileId: null,
    name: "Sensitive request",
    method: "POST",
    url: "https://example.test/facts?access_token=do-not-leak",
    position: 0,
    settings: {
      cookies: [{ name: "session", value: "do-not-leak", enabled: true }],
    },
  });
  result.requestHeaders.push({
    id: randomUUID(),
    requestId,
    name: "Authorization",
    value: "do-not-leak",
    enabled: true,
    secret: false,
    position: 0,
  });
  result.requestQueryParameters.push({
    id: randomUUID(),
    requestId,
    name: "api_key",
    value: "do-not-leak",
    enabled: true,
    position: 0,
  });
  result.requestBodies.push({
    id: randomUUID(),
    requestId,
    type: "json",
    content: '{"password":"do-not-leak"}',
    contentType: "application/json",
    metadata: {},
  });
  result.importedOperations.push({
    id: randomUUID(),
    definitionId: randomUUID(),
    sourceKey: "post:/facts",
    method: "POST",
    path: "/facts",
    operation: { authorization: "do-not-leak" },
  });
  return { result, workspaceId };
}

describe("versioned export archives", () => {
  it("excludes secret values by default", async () => {
    const { result, workspaceId } = tables();
    const { archive, manifest } = await createExportArchive({
      tables: result,
      kind: "workspace",
      scope: { id: workspaceId, name: "Portable" },
      secretMode: "exclude",
      createdAt: new Date("2026-07-18T12:00:00.000Z"),
    });

    expect(Buffer.from(archive).includes(Buffer.from("do-not-leak"))).toBe(
      false,
    );
    expect(manifest.version).toBe(1);
    expect(manifest.files.secrets).toBeNull();
    const parsed = await parseExportArchive(archive);
    expect(parsed.data.tables.variables[0]?.value).toBe("");
    expect(parsed.data.tables.requestHeaders[0]?.value).toBe("");
    expect(parsed.data.tables.requestQueryParameters[0]?.value).toBe("");
    expect(parsed.data.tables.requestBodies[0]?.content).toBe("");
    expect(parsed.data.tables.savedRequests[0]?.url).toBe(
      "https://example.test/facts?access_token=",
    );
  });

  it("round-trips encrypted secrets only with the right password", async () => {
    const { result, workspaceId } = tables();
    const { archive } = await createExportArchive({
      tables: result,
      kind: "workspace",
      scope: { id: workspaceId, name: "Portable" },
      secretMode: "encrypted",
      password: "correct horse battery staple",
    });

    expect(Buffer.from(archive).includes(Buffer.from("do-not-leak"))).toBe(
      false,
    );
    await expect(
      parseExportArchive(archive, "wrong password"),
    ).rejects.toMatchObject({ code: "EXPORT_DECRYPT_FAILED" });
    const parsed = await parseExportArchive(
      archive,
      "correct horse battery staple",
    );
    expect(parsed.data.tables.variables[0]?.value).toBe("do-not-leak");
    expect(parsed.data.tables.requestBodies[0]?.content).toContain(
      "do-not-leak",
    );
    expect(parsed.data.tables.savedRequests[0]?.url).toContain("do-not-leak");
  });

  it("marks explicit plain-text secret archives with a warning", async () => {
    const { result, workspaceId } = tables();
    const { archive, manifest } = await createExportArchive({
      tables: result,
      kind: "workspace",
      scope: { id: workspaceId, name: "Portable" },
      secretMode: "plaintext",
    });

    expect(manifest.warning).toContain("unencrypted secret values");
    const parsed = await parseExportArchive(archive);
    expect(parsed.data.tables.variables[0]?.value).toBe("do-not-leak");
  });

  it("rejects unsupported versions, counts, paths, and damaged data", async () => {
    const { result, workspaceId } = tables();
    const { archive } = await createExportArchive({
      tables: result,
      kind: "workspace",
      scope: { id: workspaceId, name: "Portable" },
      secretMode: "exclude",
    });

    const unsupported = mutateZipJson(archive, "manifest.json", (manifest) => {
      manifest.version = 99;
    });
    await expect(parseExportArchive(unsupported)).rejects.toBeTruthy();

    const wrongCount = mutateZipJson(archive, "manifest.json", (manifest) => {
      const counts = manifest.recordCounts as Record<string, number>;
      counts.workspaces = 99;
    });
    await expect(parseExportArchive(wrongCount)).rejects.toMatchObject({
      message: "Record count failed for workspaces.",
    });

    const unsafeFiles = unzipSync(archive);
    unsafeFiles["../escape.txt"] = strToU8("not allowed");
    const unsafePath = zipSync(unsafeFiles, { level: 6 });
    await expect(parseExportArchive(unsafePath)).rejects.toMatchObject({
      message: "Archive path is not allowed: ../escape.txt",
    });

    const damaged = mutateZipJson(archive, "data.json", (data) => {
      data.tables = {};
    });
    await expect(parseExportArchive(damaged)).rejects.toBeInstanceOf(
      ExportDomainError,
    );
  });

  it("rejects files that expand past the per-file limit", async () => {
    const oversized = zipSync(
      { "data.json": new Uint8Array(MAX_EXPORT_FILE_BYTES + 1) },
      { level: 1 },
    );
    await expect(parseExportArchive(oversized)).rejects.toMatchObject({
      message: "An archive file is too large.",
    });
  }, 20_000);
});
