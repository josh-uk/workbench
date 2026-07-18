import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { updateSavedRequestAction } from "@/features/requests/actions";
import type {
  ExecutionDetail,
  SavedRequestDetail,
} from "@/features/requests/domain";

import { RequestEditor } from "./request-editor";
import { ResponseViewer } from "./response-viewer";

vi.mock("@/features/requests/actions", () => ({
  duplicateSavedRequestAction: vi.fn(),
  updateSavedRequestAction: vi.fn(),
}));

const execution: ExecutionDetail = {
  id: "a47ac10b-58cc-4372-a567-0e02b2c3d479",
  requestId: "b47ac10b-58cc-4372-a567-0e02b2c3d479",
  projectId: "c47ac10b-58cc-4372-a567-0e02b2c3d479",
  status: "succeeded",
  method: "GET",
  resolvedUrl: "https://example.test/facts",
  requestSnapshot: { method: "GET" },
  error: null,
  startedAt: "2026-07-18T12:00:00.000Z",
  completedAt: "2026-07-18T12:00:00.020Z",
  createdAt: "2026-07-18T12:00:00.000Z",
  outputs: [],
  response: {
    statusCode: 200,
    statusText: "OK",
    durationMs: 20,
    sizeBytes: 26,
    headers: [{ name: "content-type", value: "application/json" }],
    cookies: [],
    redirects: [],
    bodyPreview: '{"fact":"Honey never spoils"}',
    bodyTruncated: false,
    contentType: "application/json",
  },
};

const detail: SavedRequestDetail = {
  id: "b47ac10b-58cc-4372-a567-0e02b2c3d479",
  authProfileId: null,
  projectId: "c47ac10b-58cc-4372-a567-0e02b2c3d479",
  folderId: null,
  name: "List facts",
  description: null,
  method: "GET",
  url: "https://example.test/facts",
  position: 0,
  tags: [],
  queryParameters: [],
  headers: [],
  requestVariables: [],
  outputDefinitions: [],
  availableAuthProfiles: [
    {
      id: "d47ac10b-58cc-4372-a567-0e02b2c3d479",
      name: "Shared OAuth",
      type: "oauth2_client_credentials",
      scope: "workspace",
    },
  ],
  availableEnvironments: {
    workspace: [{ id: "d47ac10b-58cc-4372-a567-0e02b2c3d479", name: "Local" }],
    project: [],
  },
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
  history: [execution],
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("RequestEditor", () => {
  it("loads, marks edits unsaved, and saves the draft", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => structuredClone(detail),
      }),
    );
    vi.mocked(updateSavedRequestAction).mockResolvedValue({
      ok: true,
      data: undefined,
    });

    render(
      <RequestEditor
        folders={[]}
        onDelete={vi.fn()}
        onNotice={vi.fn()}
        onRefresh={vi.fn()}
        onSelectRequest={vi.fn()}
        requestId={detail.id}
      />,
    );

    expect(await screen.findByLabelText("Request URL")).toHaveValue(detail.url);
    await user.clear(screen.getByLabelText("Request name"));
    await user.type(screen.getByLabelText("Request name"), "Updated facts");
    expect(screen.getByText("Unsaved changes")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateSavedRequestAction).toHaveBeenCalled());
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
  });

  it("selects authentication and configures a reusable output", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => structuredClone(detail),
      }),
    );
    vi.mocked(updateSavedRequestAction).mockResolvedValue({
      ok: true,
      data: undefined,
    });
    render(
      <RequestEditor
        folders={[]}
        onDelete={vi.fn()}
        onNotice={vi.fn()}
        onRefresh={vi.fn()}
        onSelectRequest={vi.fn()}
        requestId={detail.id}
      />,
    );

    await screen.findByLabelText("Request URL");
    await user.click(screen.getByRole("button", { name: "Auth" }));
    await user.selectOptions(
      screen.getByLabelText("Authentication profile"),
      "d47ac10b-58cc-4372-a567-0e02b2c3d479",
    );
    await user.click(screen.getAllByRole("button", { name: "Outputs" })[0]!);
    await user.click(screen.getByRole("button", { name: "Add output" }));
    await user.clear(screen.getByLabelText("Output 1 name"));
    await user.type(screen.getByLabelText("Output 1 name"), "entityId");
    await user.clear(screen.getByLabelText("Output 1 JSONPath"));
    await user.type(screen.getByLabelText("Output 1 JSONPath"), "$.entity.id");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(updateSavedRequestAction).toHaveBeenLastCalledWith(
        expect.objectContaining({
          authProfileId: "d47ac10b-58cc-4372-a567-0e02b2c3d479",
          outputDefinitions: [
            expect.objectContaining({
              name: "entityId",
              jsonPath: "$.entity.id",
            }),
          ],
        }),
      ),
    );
  });

  it("renders bounded load errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "Saved request not found." }),
      }),
    );
    render(
      <RequestEditor
        folders={[]}
        onDelete={vi.fn()}
        onNotice={vi.fn()}
        onRefresh={vi.fn()}
        onSelectRequest={vi.fn()}
        requestId={detail.id}
      />,
    );
    expect(await screen.findByText("Saved request not found.")).toBeVisible();
  });

  it("previews variable origins while keeping secret values masked", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => structuredClone(detail),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          preview: {
            method: "GET",
            url: "https://api.test/facts",
            queryParameters: [],
            headers: [
              {
                name: "Authorization",
                value: "Bearer ••••••••",
                enabled: true,
                secret: true,
              },
            ],
            cookies: [],
            body: {
              type: "none",
              content: null,
              contentType: null,
              secret: false,
            },
          },
          variables: [
            {
              name: "token",
              preview: "••••••••",
              secret: true,
              origin: "runtime",
              originLabel: "Temporary runtime override",
              unresolved: [],
              errors: [],
            },
          ],
          unresolved: [],
          errors: [],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(updateSavedRequestAction).mockResolvedValue({
      ok: true,
      data: undefined,
    });

    render(
      <RequestEditor
        folders={[]}
        onDelete={vi.fn()}
        onNotice={vi.fn()}
        onRefresh={vi.fn()}
        onSelectRequest={vi.fn()}
        requestId={detail.id}
      />,
    );
    await screen.findByLabelText("Request URL");
    await user.click(screen.getByRole("button", { name: "Variables" }));
    await user.click(
      screen.getAllByRole("button", { name: "Add variable" })[1]!,
    );
    await user.type(screen.getByLabelText("Variable name 1"), "token");
    await user.type(screen.getByLabelText("Variable value 1"), "super-secret");
    await user.click(
      screen.getByRole("button", { name: "Preview resolved request" }),
    );

    expect(await screen.findByText("https://api.test/facts")).toBeVisible();
    expect(screen.getByText("••••••••")).toBeVisible();
    expect(screen.queryByText("super-secret")).not.toBeInTheDocument();
  });
});

describe("ResponseViewer", () => {
  it("shows formatted bodies, headers, and selectable history", async () => {
    const user = userEvent.setup();
    render(
      <ResponseViewer
        execution={execution}
        history={[execution]}
        onSelectHistory={vi.fn()}
      />,
    );
    expect(screen.getByText("200 OK")).toBeVisible();
    expect(screen.getByText(/Honey never spoils/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Headers" }));
    expect(screen.getByText("content-type")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "History 1" }));
    expect(screen.getByText("https://example.test/facts")).toBeVisible();
  });
});
