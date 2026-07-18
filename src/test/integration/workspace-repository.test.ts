import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closeDatabase } from "@/db/client";
import {
  createFolder,
  createProject,
  createWorkspace,
  deleteWorkspace,
  duplicateProject,
  duplicateWorkspace,
  getWorkbenchNavigation,
  moveProject,
  relocateFolder,
  selectWorkspace,
  setProjectArchived,
  updateFolder,
  updateProject,
  updateWorkspace,
} from "@/features/workspaces/data/workspace-repository";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("workspace repository", () => {
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

  it("persists workspace, project, ordering, archive, and folder hierarchy changes", async () => {
    const work = await createWorkspace({
      name: "Work",
      description: "Main APIs",
    });
    const personal = await createWorkspace({
      name: "Personal",
      description: null,
    });
    await selectWorkspace(work.id);

    const projectA = await createProject({
      workspaceId: work.id,
      name: "Project A",
      description: "Primary project",
    });
    const projectB = await createProject({
      workspaceId: work.id,
      name: "Project B",
      description: null,
    });
    const root = await createFolder({
      projectId: projectA.id,
      parentId: null,
      name: "Facts",
    });
    const child = await createFolder({
      projectId: projectA.id,
      parentId: root.id,
      name: "Drafts",
    });

    await updateWorkspace(work.id, {
      name: "Work APIs",
      description: "Renamed",
    });
    await updateProject(projectA.id, { name: "Core API", description: null });
    await updateFolder(child.id, "Examples");
    await moveProject(projectB.id, "up");
    await setProjectArchived(projectB.id, true);

    const navigation = await getWorkbenchNavigation();
    expect(navigation.activeWorkspaceId).toBe(work.id);
    expect(navigation.workspaces.map(({ name }) => name)).toEqual([
      "Work APIs",
      "Personal",
    ]);
    expect(navigation.workspaces[0]?.projects.map(({ name }) => name)).toEqual([
      "Project B",
      "Core API",
    ]);
    expect(navigation.workspaces[0]?.projects[0]?.archived).toBe(true);
    expect(navigation.workspaces[0]?.projects[1]?.folders[0]).toMatchObject({
      name: "Facts",
      children: [{ name: "Examples" }],
    });

    await expect(relocateFolder(root.id, child.id)).rejects.toThrow(
      "descendants",
    );
    await deleteWorkspace(work.id);

    expect((await getWorkbenchNavigation()).activeWorkspaceId).toBe(
      personal.id,
    );
  });

  it("duplicates workspace and project folder structures with unique names", async () => {
    const workspace = await createWorkspace({
      name: "Work",
      description: null,
    });
    const project = await createProject({
      workspaceId: workspace.id,
      name: "Project A",
      description: null,
    });
    const root = await createFolder({
      projectId: project.id,
      parentId: null,
      name: "Authentication",
    });
    await createFolder({
      projectId: project.id,
      parentId: root.id,
      name: "Tokens",
    });

    await duplicateProject(project.id);
    await duplicateProject(project.id);
    await duplicateWorkspace(workspace.id);

    const navigation = await getWorkbenchNavigation();
    expect(navigation.workspaces.map(({ name }) => name)).toEqual([
      "Work",
      "Work copy",
    ]);
    expect(navigation.activeWorkspaceId).toBe(navigation.workspaces[1]?.id);
    expect(navigation.workspaces[0]?.projects.map(({ name }) => name)).toEqual([
      "Project A",
      "Project A copy",
      "Project A copy 2",
    ]);
    expect(
      navigation.workspaces[0]?.projects.every(
        ({ folders }) => folders[0]?.children[0]?.name === "Tokens",
      ),
    ).toBe(true);
    expect(navigation.workspaces[1]?.projects).toHaveLength(3);
  });

  it("rejects case-insensitive naming conflicts", async () => {
    await createWorkspace({ name: "Work", description: null });

    await expect(
      createWorkspace({ name: "work", description: null }),
    ).rejects.toThrow("already exists");
  });
});
