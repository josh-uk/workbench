import { describe, expect, it } from "vitest";

import {
  buildFolderTree,
  collectFolderIds,
  createCopyName,
  createWorkspaceSchema,
} from "./domain";

describe("workspace domain", () => {
  it("normalises and validates workspace input", () => {
    expect(
      createWorkspaceSchema.parse({
        name: "  Client APIs  ",
        description: "  ",
      }),
    ).toEqual({ name: "Client APIs", description: null });

    expect(() => createWorkspaceSchema.parse({ name: "   " })).toThrow(
      "Name is required",
    );
  });

  it("builds a stable nested folder tree", () => {
    const tree = buildFolderTree([
      {
        id: "child",
        projectId: "project",
        parentId: "root",
        name: "Child",
        position: 0,
      },
      {
        id: "second",
        projectId: "project",
        parentId: null,
        name: "Second",
        position: 1,
      },
      {
        id: "root",
        projectId: "project",
        parentId: null,
        name: "Root",
        position: 0,
        requestCount: 2,
      },
    ]);

    expect(tree).toHaveLength(2);
    expect(tree[0]).toMatchObject({ id: "root", requestCount: 2 });
    expect(tree[0]?.children[0]?.id).toBe("child");
    expect(collectFolderIds(tree)).toEqual(["root", "child", "second"]);
  });

  it("promotes invalid cross-project parents to roots", () => {
    const tree = buildFolderTree([
      {
        id: "parent",
        projectId: "one",
        parentId: null,
        name: "Parent",
        position: 0,
      },
      {
        id: "child",
        projectId: "two",
        parentId: "parent",
        name: "Child",
        position: 0,
      },
    ]);

    expect(tree.map(({ id }) => id)).toEqual(["child", "parent"]);
  });

  it("creates collision-free copy names case-insensitively", () => {
    expect(createCopyName("Project A", ["Project A"])).toBe("Project A copy");
    expect(
      createCopyName("Project A", [
        "Project A",
        "project a COPY",
        "Project A copy 2",
      ]),
    ).toBe("Project A copy 3");
  });
});
