import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BackupManager } from "./backup-manager";

const overview = {
  backup: {
    automatic: false,
    intervalHours: 24,
    retentionCount: 7,
    secretMode: "exclude" as const,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastError: null,
  },
  retention: { executionHistoryLimit: 100 },
  backups: [
    {
      name: "workbench-backup-2026-07-18T12-00-00-000Z.zip",
      sizeBytes: 2_048,
      createdAt: "2026-07-18T12:00:00.000Z",
    },
  ],
  encryptedPasswordConfigured: false,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BackupManager", () => {
  it("shows secret warnings and saves automatic backup retention", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          return new Response(JSON.stringify(overview), {
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify(overview), {
          headers: { "Content-Type": "application/json" },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <BackupManager
        activeWorkspace={{ id: "workspace", name: "Work" }}
        onClose={vi.fn()}
        onRefresh={vi.fn()}
        project={{ id: "project", name: "Core API" }}
        workspaces={[{ id: "workspace", name: "Work" }]}
      />,
    );

    expect(
      await screen.findByRole("heading", {
        name: "Export, backup, and restore",
      }),
    ).toBeVisible();
    expect(await screen.findByText("2 KiB")).toBeVisible();

    await user.selectOptions(
      screen.getByLabelText("Secret handling"),
      "plaintext",
    );
    expect(
      screen.getByText("I understand this archive exposes credentials", {
        exact: false,
      }),
    ).toBeVisible();

    await user.click(screen.getByLabelText("Enable automatic backups"));
    await user.clear(screen.getByLabelText("Keep backups"));
    await user.type(screen.getByLabelText("Keep backups"), "3");
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/backups",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining('"retentionCount":3'),
        }),
      ),
    );
  });
});
