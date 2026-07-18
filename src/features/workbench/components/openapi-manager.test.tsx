import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  executeOpenApiImportAction,
  listImportedDefinitionsAction,
  previewOpenApiImportAction,
} from "@/features/openapi/actions";
import type { OpenApiImportPreview } from "@/features/openapi/domain";

import { OpenApiManager } from "./openapi-manager";

vi.mock("@/features/openapi/actions", () => ({
  applyOpenApiRefreshAction: vi.fn(),
  executeOpenApiImportAction: vi.fn(),
  listImportedDefinitionsAction: vi.fn(),
  previewOpenApiImportAction: vi.fn(),
  previewOpenApiRefreshAction: vi.fn(),
}));

const preview: OpenApiImportPreview = {
  projectId: "b47ac10b-58cc-4372-a567-0e02b2c3d479",
  existingDefinitionId: null,
  conflicts: [],
  format: "openapi_yaml",
  originalDocument:
    "openapi: 3.1.0\ninfo: { title: Facts API, version: 1.0.0 }\npaths: {}\n",
  sourceHash: "source-hash",
  openapiVersion: "3.1.0",
  title: "Facts API",
  apiVersion: "1.0.0",
  servers: [
    {
      url: "https://api.example.test",
      resolvedUrl: "https://api.example.test",
      description: null,
      variables: {},
    },
  ],
  tags: [{ name: "Facts", description: null }],
  securitySchemes: {},
  securityProposals: [],
  schemas: {},
  globalSecurity: [],
  warnings: [],
  operations: [
    {
      sourceKey: "GET /facts/{id}",
      method: "GET",
      path: "/facts/{id}",
      operationId: "getFact",
      name: "Get a fact",
      summary: "Get a fact",
      description: null,
      tags: ["Facts"],
      primaryTag: "Facts",
      deprecated: false,
      securitySchemeNames: [],
      serverUrl: "https://api.example.test",
      generatedRequest: {
        name: "Get a fact",
        description: "",
        method: "GET",
        url: "https://api.example.test/facts/{{id}}",
        tags: ["Facts"],
        queryParameters: [],
        headers: [],
        requestVariables: [
          { name: "id", value: "fact-1", enabled: true, secret: false },
        ],
        body: { type: "none", content: null, contentType: null, metadata: {} },
      },
      operation: {},
      operationHash: "operation-hash",
      warnings: [],
      conflict: null,
    },
  ],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("OpenApiManager", () => {
  it("previews a pasted document and applies the selected import plan", async () => {
    const user = userEvent.setup();
    const onNotice = vi.fn();
    vi.mocked(listImportedDefinitionsAction).mockResolvedValue({
      ok: true,
      data: [],
    });
    vi.mocked(previewOpenApiImportAction).mockResolvedValue({
      ok: true,
      data: preview,
    });
    vi.mocked(executeOpenApiImportAction).mockResolvedValue({
      ok: true,
      data: {
        definitionId: "c47ac10b-58cc-4372-a567-0e02b2c3d479",
        createdRequests: 1,
        replacedRequests: 0,
        skippedRequests: 0,
        createdFolders: 1,
        createdAuthProfiles: 0,
        serverVariableName: "baseUrl",
        warnings: [],
      },
    });

    render(
      <OpenApiManager
        onClose={vi.fn()}
        onNotice={onNotice}
        onRefresh={vi.fn()}
        project={{
          id: "b47ac10b-58cc-4372-a567-0e02b2c3d479",
          name: "Facts",
        }}
      />,
    );

    expect(await screen.findByText("No imported definitions")).toBeVisible();
    await user.click(
      screen.getAllByRole("button", { name: "Import OpenAPI" })[0]!,
    );
    await user.type(
      screen.getByLabelText("OpenAPI JSON or YAML"),
      "openapi: 3.1.0",
    );
    await user.click(screen.getByRole("button", { name: "Preview import" }));

    expect(await screen.findByText("Facts API")).toBeVisible();
    expect(screen.getByText("/facts/{id}")).toBeVisible();
    expect(screen.getByLabelText("Folder for Facts")).toHaveValue("Facts");
    await user.click(screen.getByRole("button", { name: "Apply import" }));

    await waitFor(() =>
      expect(executeOpenApiImportAction).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "b47ac10b-58cc-4372-a567-0e02b2c3d479",
          source: expect.objectContaining({
            sourceType: "paste",
            content: preview.originalDocument,
          }),
          options: expect.objectContaining({
            name: "Facts API",
            selectedOperationKeys: ["GET /facts/{id}"],
            tagFolders: { Facts: "Facts" },
          }),
        }),
      ),
    );
    expect(onNotice).toHaveBeenCalledWith(
      "success",
      "Imported 1 requests from Facts API.",
    );
  });
});
