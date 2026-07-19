import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./azure-cli", () => ({
  getKeyVaultAccessToken: vi.fn().mockResolvedValue({
    accessToken: "azure-access-token",
    expiresOn: 2_000_000_000,
    tenantId: "tenant-id",
    tokenType: "Bearer",
  }),
}));

import { resolveKeyVaultSecret } from "./key-vault";

const reference = {
  provider: "azure_key_vault" as const,
  vaultUrl: "https://workbench-secrets.vault.azure.net/",
  secretName: "api-secret",
  version: "",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Azure Key Vault resolution", () => {
  it("gets the latest secret without exposing the access token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ value: "resolved-value" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveKeyVaultSecret(reference)).resolves.toBe(
      "resolved-value",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      new URL(
        "https://workbench-secrets.vault.azure.net/secrets/api-secret?api-version=2025-07-01",
      ),
      expect.objectContaining({
        cache: "no-store",
        redirect: "error",
        headers: expect.objectContaining({
          Authorization: "Bearer azure-access-token",
        }),
      }),
    );
  });

  it("pins an exact secret version when configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ value: "versioned-value" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const version = "0123456789abcdef0123456789abcdef";

    await resolveKeyVaultSecret({ ...reference, version });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      `/secrets/api-secret/${version}?api-version=2025-07-01`,
    );
  });

  it.each([
    [401, "Reconnect Azure"],
    [403, "does not have permission"],
    [404, "was not found"],
    [429, "throttling"],
    [500, "could not resolve"],
  ])("maps status %s to a sanitized error", async (status, message) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status }));
    await expect(resolveKeyVaultSecret(reference)).rejects.toThrow(message);
    await expect(resolveKeyVaultSecret(reference)).rejects.not.toThrow(
      "azure-access-token",
    );
  });

  it.each([
    ["SecretDisabled", "disabled"],
    ["SecretExpired", "expired"],
  ])(
    "returns actionable, sanitized diagnostics for %s",
    async (code, message) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation(
          () =>
            new Response(
              JSON.stringify({
                error: {
                  code: "Forbidden",
                  message: "internal vault detail azure-access-token",
                  innererror: { code },
                },
              }),
              { status: 403 },
            ),
        ),
      );

      await expect(resolveKeyVaultSecret(reference)).rejects.toThrow(message);
      await expect(resolveKeyVaultSecret(reference)).rejects.not.toThrow(
        "azure-access-token",
      );
    },
  );
});
