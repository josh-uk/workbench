import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WorkbenchShell } from "./workbench-shell";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/features/requests/actions", () => ({
  createSavedRequestAction: vi.fn(),
  deleteSavedRequestAction: vi.fn(),
  duplicateSavedRequestAction: vi.fn(),
  moveSavedRequestAction: vi.fn(),
  updateSavedRequestAction: vi.fn(),
}));

vi.mock("@/features/workspaces/actions", () => ({
  archiveProjectAction: vi.fn(),
  createFolderAction: vi.fn(),
  createProjectAction: vi.fn(),
  createWorkspaceAction: vi.fn(),
  deleteFolderAction: vi.fn(),
  deleteProjectAction: vi.fn(),
  deleteWorkspaceAction: vi.fn(),
  duplicateProjectAction: vi.fn(),
  duplicateWorkspaceAction: vi.fn(),
  moveFolderAction: vi.fn(),
  moveProjectAction: vi.fn(),
  relocateFolderAction: vi.fn(),
  restoreProjectAction: vi.fn(),
  selectWorkspaceAction: vi.fn(),
  updateFolderAction: vi.fn(),
  updateProjectAction: vi.fn(),
  updateWorkspaceAction: vi.fn(),
}));

vi.mock("@/features/variables/actions", () => ({
  createEnvironmentAction: vi.fn(),
  deleteEnvironmentAction: vi.fn(),
  duplicateEnvironmentAction: vi.fn(),
  saveVariableScopeAction: vi.fn(),
  updateEnvironmentAction: vi.fn(),
}));

describe("WorkbenchShell", () => {
  it("guides an empty installation into workspace creation", async () => {
    const user = userEvent.setup();
    render(
      <WorkbenchShell
        navigation={{ activeWorkspaceId: null, workspaces: [] }}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Start with a workspace" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Create workspace" }));
    expect(
      screen.getByRole("dialog", { name: "Create workspace" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Name")).toHaveFocus();
  });

  it("renders persisted projects and nested folders", () => {
    render(
      <WorkbenchShell
        navigation={{
          activeWorkspaceId: "workspace",
          workspaces: [
            {
              id: "workspace",
              name: "Work",
              description: null,
              position: 0,
              projects: [
                {
                  id: "project",
                  workspaceId: "workspace",
                  name: "Project A",
                  description: "Primary API",
                  position: 0,
                  archived: false,
                  requestCount: 0,
                  executionCount: 0,
                  requests: [],
                  folders: [
                    {
                      id: "folder",
                      projectId: "project",
                      parentId: null,
                      name: "Facts",
                      position: 0,
                      requestCount: 0,
                      children: [
                        {
                          id: "child",
                          projectId: "project",
                          parentId: "folder",
                          name: "Examples",
                          position: 0,
                          requestCount: 0,
                          children: [],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Project A" })).toBeVisible();
    expect(screen.getAllByText("Facts").length).toBeGreaterThan(0);
    expect(screen.getByText("Examples")).toBeVisible();
    expect(screen.getByText("2 total")).toBeVisible();
  });

  it("collapses and restores the project sidebar", async () => {
    const user = userEvent.setup();
    render(
      <WorkbenchShell
        navigation={{ activeWorkspaceId: null, workspaces: [] }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(screen.getByRole("button", { name: "Open sidebar" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Open sidebar" }));
    expect(
      screen.getByRole("button", { name: "Collapse sidebar" }),
    ).toBeVisible();
  });
});
