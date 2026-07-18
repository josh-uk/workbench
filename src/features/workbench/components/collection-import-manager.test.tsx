import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  executeCollectionImportAction,
  listCollectionImportsAction,
  previewCollectionImportAction,
} from "@/features/imports/actions";
import type { CollectionImportPreview } from "@/features/imports/domain";

import { CollectionImportManager } from "./collection-import-manager";

vi.mock("@/features/imports/actions", () => ({
  executeCollectionImportAction: vi.fn(),
  listCollectionImportsAction: vi.fn(),
  previewCollectionImportAction: vi.fn(),
}));

const preview: CollectionImportPreview = {
  format: "httpie",
  formatVersion: "1.0.0",
  name: "Payments workspace",
  sourceHash: "source-hash",
  target: {
    workspaceId: "a47ac10b-58cc-4372-a567-0e02b2c3d479",
    workspaceName: "Work",
    projectId: "b47ac10b-58cc-4372-a567-0e02b2c3d479",
    projectName: "Payments",
  },
  requests: [
    {
      sourceKey: "httpie:request-list",
      name: "List payments",
      description: "",
      folderPath: ["Payments API"],
      method: "GET",
      url: "https://api.example.test/payments",
      queryParameters: [],
      headers: [],
      requestVariables: [],
      body: { type: "none", content: null, contentType: null, metadata: {} },
      settings: {
        timeoutMs: 30_000,
        followRedirects: true,
        maxRedirects: 5,
        tlsVerify: true,
        maxResponseBytes: 1_048_576,
        allowPrivateNetwork: false,
        cookies: [],
      },
      authProfileKey: "httpie:auth",
      sourceMetadata: { httpieId: "request-list" },
    },
  ],
  environments: [
    {
      sourceKey: "httpie:environment",
      name: "Staging",
      variables: [
        {
          name: "accessToken",
          value: "token",
          secret: true,
          enabled: true,
        },
      ],
      sourceMetadata: {},
    },
  ],
  projectVariables: [],
  authProfiles: [
    {
      sourceKey: "httpie:auth",
      name: "Payments Bearer auth",
      type: "bearer",
      configuration: { token: "{{accessToken}}" },
    },
  ],
  unsupported: ["A file attachment requires reselection."],
  warnings: [],
  conflicts: [
    {
      key: "request:httpie:request-list",
      kind: "request",
      label: "List payments",
      details: "A request named List payments already exists in Payments API.",
    },
  ],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CollectionImportManager", () => {
  it("previews a source and imports the selected plan", async () => {
    const user = userEvent.setup();
    const onNotice = vi.fn();
    vi.mocked(listCollectionImportsAction).mockResolvedValue({
      ok: true,
      data: [],
    });
    vi.mocked(previewCollectionImportAction).mockResolvedValue({
      ok: true,
      data: preview,
    });
    vi.mocked(executeCollectionImportAction).mockResolvedValue({
      ok: true,
      data: {
        definitionId: "c47ac10b-58cc-4372-a567-0e02b2c3d479",
        createdFolders: 1,
        createdRequests: 1,
        replacedRequests: 0,
        mergedRequests: 0,
        skippedRequests: 0,
        createdEnvironments: 1,
        createdVariables: 1,
        createdAuthProfiles: 1,
        warnings: [],
      },
    });

    render(
      <CollectionImportManager
        onClose={vi.fn()}
        onNotice={onNotice}
        onRefresh={vi.fn()}
        project={{
          id: "b47ac10b-58cc-4372-a567-0e02b2c3d479",
          name: "Payments",
        }}
      />,
    );

    expect(await screen.findByText("No collection imports")).toBeVisible();
    await user.click(
      screen.getAllByRole("button", { name: "Import source" })[0]!,
    );
    await user.type(
      screen.getByLabelText("Import source"),
      "http GET :4010/payments",
    );
    await user.click(screen.getByRole("button", { name: "Preview import" }));

    expect(await screen.findByText("Payments workspace")).toBeVisible();
    expect(screen.getByText("Work / Payments", { exact: false })).toBeVisible();
    expect(
      screen.getByText("A request named List payments", { exact: false }),
    ).toBeVisible();
    expect(
      screen.getByText("A file attachment requires reselection."),
    ).toBeVisible();
    await user.selectOptions(
      screen.getByLabelText("Naming conflicts"),
      "merge",
    );
    await user.click(screen.getByRole("button", { name: "Import 1 request" }));

    await waitFor(() =>
      expect(executeCollectionImportAction).toHaveBeenCalledWith({
        projectId: "b47ac10b-58cc-4372-a567-0e02b2c3d479",
        previewSourceHash: "source-hash",
        source: {
          sourceType: "paste",
          content: "http GET :4010/payments",
          format: "auto",
        },
        options: expect.objectContaining({
          definitionName: "Payments workspace",
          selectedRequestKeys: ["httpie:request-list"],
          conflictStrategy: "merge",
          includeEnvironments: true,
          includeAuthProfiles: true,
        }),
      }),
    );
    expect(onNotice).toHaveBeenCalledWith("success", "Imported 1 request.");
  });
});
