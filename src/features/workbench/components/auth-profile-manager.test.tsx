import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { saveAuthProfileAction } from "@/features/authentication/actions";
import { defaultAuthConfiguration } from "@/features/authentication/domain";

import { AuthProfileManager } from "./auth-profile-manager";

vi.mock("@/features/authentication/actions", () => ({
  deleteAuthProfileAction: vi.fn(),
  saveAuthOverrideAction: vi.fn(),
  saveAuthProfileAction: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AuthProfileManager", () => {
  it("loads redacted profiles and saves OAuth client configuration", async () => {
    const user = userEvent.setup();
    const configuration = {
      profiles: [
        {
          id: "a47ac10b-58cc-4372-a567-0e02b2c3d479",
          workspaceId: null,
          projectId: "b47ac10b-58cc-4372-a567-0e02b2c3d479",
          tokenRequestId: null,
          name: "Project OAuth",
          type: "oauth2_client_credentials" as const,
          configuration: {
            ...defaultAuthConfiguration(),
            tokenUrl: "https://auth.example.test/token",
            clientId: "workbench-client",
            clientSecret: "••••••••",
          },
          inherited: false,
          overridden: false,
        },
      ],
      tokenRequests: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => structuredClone(configuration),
      }),
    );
    vi.mocked(saveAuthProfileAction).mockResolvedValue({
      ok: true,
      data: { id: configuration.profiles[0].id },
    });

    render(
      <AuthProfileManager
        onClose={vi.fn()}
        project={{
          id: "b47ac10b-58cc-4372-a567-0e02b2c3d479",
          name: "Facts API",
        }}
        workspace={{
          id: "c47ac10b-58cc-4372-a567-0e02b2c3d479",
          name: "Work",
        }}
      />,
    );

    expect(await screen.findByDisplayValue("Project OAuth")).toBeVisible();
    expect(screen.getByDisplayValue("••••••••")).toHaveAttribute(
      "type",
      "password",
    );
    await user.clear(screen.getByLabelText("Client ID"));
    await user.type(screen.getByLabelText("Client ID"), "updated-client");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(saveAuthProfileAction).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Project OAuth",
          configuration: expect.objectContaining({
            clientId: "updated-client",
            clientSecret: "••••••••",
          }),
        }),
      ),
    );
  });
});
