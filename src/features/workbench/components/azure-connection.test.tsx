import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AzureConnection } from "./azure-connection";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AzureConnection", () => {
  it("starts and cancels device-code login entirely from the UI", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/login") && init?.method === "POST") {
          return {
            ok: true,
            json: async () => ({
              status: "waiting",
              cliAvailable: true,
              verificationUrl: "https://microsoft.com/devicelogin",
              userCode: "AB12-CD34",
              expiresAt: "2026-07-19T15:00:00.000Z",
            }),
          };
        }
        if (url.endsWith("/login") && init?.method === "DELETE") {
          return { ok: true, json: async () => ({ ok: true }) };
        }
        return {
          ok: true,
          json: async () => ({ status: "disconnected", cliAvailable: true }),
        };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<AzureConnection />);
    await user.click(
      await screen.findByRole("button", { name: "Connect Azure" }),
    );
    await user.type(
      screen.getByLabelText(/Tenant ID or domain/),
      "contoso.onmicrosoft.com",
    );
    await user.click(screen.getByRole("button", { name: "Start sign-in" }));

    expect(await screen.findByText("AB12-CD34")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/configuration/azure/login",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ tenant: "contoso.onmicrosoft.com" }),
      }),
    );

    await user.click(screen.getByRole("button", { name: "Cancel sign-in" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/configuration/azure/login",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
  });

  it("shows only sanitized connected account metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "connected",
          cliAvailable: true,
          account: {
            name: "Personal subscription",
            username: "user@example.test",
            tenantId: "00000000-0000-0000-0000-000000000000",
            subscriptionId: "11111111-1111-1111-1111-111111111111",
          },
        }),
      }),
    );

    render(<AzureConnection />);
    expect(await screen.findByText("user@example.test")).toBeVisible();
    expect(screen.getByText(/Personal subscription/)).toBeVisible();
    expect(screen.queryByText(/access.?token/i)).not.toBeInTheDocument();
  });
});
