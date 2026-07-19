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
      vi.fn(async (input: RequestInfo | URL) => ({
        ok: true,
        json: async () =>
          String(input).includes("/azure")
            ? { status: "disconnected", cliAvailable: true }
            : structuredClone(configuration),
      })),
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

  it("saves an Azure Key Vault source without a stored secret", async () => {
    const user = userEvent.setup();
    const configuration = {
      profiles: [
        {
          id: "a47ac10b-58cc-4372-a567-0e02b2c3d479",
          workspaceId: null,
          projectId: "b47ac10b-58cc-4372-a567-0e02b2c3d479",
          tokenRequestId: null,
          name: "Bearer profile",
          type: "bearer" as const,
          configuration: {
            ...defaultAuthConfiguration(),
            token: "••••••••",
          },
          inherited: false,
          overridden: false,
        },
      ],
      tokenRequests: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => ({
        ok: true,
        json: async () =>
          String(input).includes("/azure")
            ? { status: "disconnected", cliAvailable: true }
            : structuredClone(configuration),
      })),
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

    await screen.findByDisplayValue("Bearer profile");
    await user.selectOptions(
      screen.getByLabelText("Source"),
      "azure_key_vault",
    );
    await user.type(
      screen.getByLabelText("Vault URL"),
      "https://workbench-secrets.vault.azure.net/",
    );
    await user.type(screen.getByLabelText("Secret name"), "bearer-token");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(saveAuthProfileAction).toHaveBeenCalledWith(
        expect.objectContaining({
          configuration: expect.objectContaining({
            token: "",
            secretReferences: expect.objectContaining({
              token: expect.objectContaining({
                provider: "azure_key_vault",
                vaultUrl: "https://workbench-secrets.vault.azure.net/",
                secretName: "bearer-token",
              }),
            }),
          }),
        }),
      ),
    );
  });
});
