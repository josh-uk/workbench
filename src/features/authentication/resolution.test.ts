import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  executeHttpRequest: vi.fn(),
  getCachedToken: vi.fn(),
  getEffectiveAuthProfile: vi.fn(),
  getLatestRequestOutput: vi.fn(),
  resolveKeyVaultSecret: vi.fn(),
  saveCachedToken: vi.fn(),
}));

vi.mock("@/features/authentication/data/auth-repository", () => ({
  getCachedToken: mocks.getCachedToken,
  getEffectiveAuthProfile: mocks.getEffectiveAuthProfile,
  saveCachedToken: mocks.saveCachedToken,
}));
vi.mock("@/features/authentication/azure/key-vault", () => ({
  resolveKeyVaultSecret: mocks.resolveKeyVaultSecret,
}));
vi.mock("@/features/request-outputs/data/request-output-repository", () => ({
  getLatestRequestOutput: mocks.getLatestRequestOutput,
}));
vi.mock("@/features/requests/execution/http-engine", () => ({
  executeHttpRequest: mocks.executeHttpRequest,
}));

import { type EffectiveAuthProfile, defaultAuthConfiguration } from "./domain";
import { resolveAuthentication } from "./resolution";
import type { RequestPlan } from "../requests/execution/http-engine";

const reference = {
  provider: "azure_key_vault" as const,
  vaultUrl: "https://workbench-secrets.vault.azure.net/",
  secretName: "credential",
  version: "",
};

const plan: RequestPlan = {
  id: "request-id",
  projectId: "project-id",
  method: "GET",
  url: "https://api.example.test",
  queryParameters: [],
  headers: [],
  body: { type: "none", content: null, contentType: null, metadata: {} },
  settings: {
    timeoutMs: 1_000,
    followRedirects: true,
    maxRedirects: 5,
    tlsVerify: true,
    maxResponseBytes: 100_000,
    allowPrivateNetwork: false,
    cookies: [],
  },
};

function profile(
  type: EffectiveAuthProfile["type"],
  configuration: Partial<EffectiveAuthProfile["configuration"]>,
): EffectiveAuthProfile {
  return {
    id: "profile-id",
    workspaceId: "workspace-id",
    projectId: null,
    tokenRequestId: null,
    name: "Azure profile",
    type,
    configuration: {
      ...defaultAuthConfiguration(),
      ...configuration,
    },
    inherited: true,
    overridden: false,
  };
}

async function resolve() {
  return resolveAuthentication({
    authProfileId: "profile-id",
    projectId: "project-id",
    plan,
    variableDefinitions: [],
    signal: new AbortController().signal,
    executeTokenRequest: vi.fn(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveKeyVaultSecret.mockResolvedValue("key-vault-secret");
  mocks.getCachedToken.mockResolvedValue(null);
});

describe("Azure-backed authentication resolution", () => {
  it("resolves a direct secret only for the active authentication field", async () => {
    mocks.getEffectiveAuthProfile.mockResolvedValue(
      profile("bearer", {
        secretReferences: {
          ...defaultAuthConfiguration().secretReferences,
          token: reference,
          password: { ...reference, secretName: "unused-password" },
        },
      }),
    );

    const result = await resolve();
    expect(mocks.resolveKeyVaultSecret).toHaveBeenCalledTimes(1);
    expect(mocks.resolveKeyVaultSecret).toHaveBeenCalledWith(
      reference,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result.plan.headers[0]).toMatchObject({
      name: "Authorization",
      value: "Bearer key-vault-secret",
      secret: true,
    });
    expect(result.trace?.credential).toBe("••••••••");
  });

  it("does not contact Key Vault while a cached OAuth token is fresh", async () => {
    mocks.getEffectiveAuthProfile.mockResolvedValue(
      profile("oauth2_client_credentials", {
        tokenUrl: "https://login.example.test/token",
        clientId: "client-id",
        secretReferences: {
          ...defaultAuthConfiguration().secretReferences,
          clientSecret: reference,
        },
      }),
    );
    mocks.getCachedToken.mockResolvedValue({
      accessToken: "cached-access-token",
      refreshToken: null,
      tokenType: "Bearer",
      expiresAt: new Date(Date.now() + 120_000),
    });

    const result = await resolve();
    expect(mocks.resolveKeyVaultSecret).not.toHaveBeenCalled();
    expect(mocks.executeHttpRequest).not.toHaveBeenCalled();
    expect(result.plan.headers[0]?.value).toBe("Bearer cached-access-token");
  });

  it("resolves the Key Vault client secret immediately before OAuth renewal", async () => {
    mocks.getEffectiveAuthProfile.mockResolvedValue(
      profile("oauth2_client_credentials", {
        tokenUrl: "https://login.example.test/token",
        clientId: "client-id",
        secretReferences: {
          ...defaultAuthConfiguration().secretReferences,
          clientSecret: reference,
        },
      }),
    );
    mocks.executeHttpRequest.mockResolvedValue({
      statusCode: 200,
      rawBody: JSON.stringify({
        access_token: "new-access-token",
        expires_in: 3600,
        token_type: "Bearer",
      }),
    });

    const result = await resolve();
    expect(mocks.resolveKeyVaultSecret).toHaveBeenCalledOnce();
    expect(mocks.executeHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          content: expect.stringContaining("client_secret=key-vault-secret"),
        }),
        secretValues: expect.arrayContaining(["key-vault-secret"]),
      }),
      expect.any(AbortSignal),
    );
    expect(mocks.saveCachedToken).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "new-access-token" }),
    );
    expect(result.plan.headers[0]?.value).toBe("Bearer new-access-token");
  });

  it("does not read an unused password reference when renewing with a cached refresh token", async () => {
    const passwordReference = { ...reference, secretName: "password" };
    mocks.getEffectiveAuthProfile.mockResolvedValue(
      profile("oauth2_password", {
        tokenUrl: "https://login.example.test/token",
        clientId: "client-id",
        username: "person@example.test",
        secretReferences: {
          ...defaultAuthConfiguration().secretReferences,
          clientSecret: reference,
          password: passwordReference,
        },
      }),
    );
    mocks.getCachedToken.mockResolvedValue({
      accessToken: "stale-access-token",
      refreshToken: "cached-refresh-token",
      tokenType: "Bearer",
      expiresAt: new Date(Date.now() - 60_000),
    });
    mocks.executeHttpRequest.mockResolvedValue({
      statusCode: 200,
      rawBody: JSON.stringify({
        access_token: "renewed-access-token",
        expires_in: 3600,
      }),
    });

    await resolve();

    expect(mocks.resolveKeyVaultSecret).toHaveBeenCalledOnce();
    expect(mocks.resolveKeyVaultSecret).toHaveBeenCalledWith(
      reference,
      expect.any(Object),
    );
    expect(mocks.executeHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          content: expect.stringContaining(
            "refresh_token=cached-refresh-token",
          ),
        }),
      }),
      expect.any(AbortSignal),
    );
  });

  it("never caches a Key Vault-backed configured refresh token", async () => {
    const refreshReference = { ...reference, secretName: "refresh-token" };
    mocks.getEffectiveAuthProfile.mockResolvedValue(
      profile("oauth2_refresh_token", {
        tokenUrl: "https://login.example.test/token",
        clientId: "client-id",
        secretReferences: {
          ...defaultAuthConfiguration().secretReferences,
          clientSecret: reference,
          refreshToken: refreshReference,
        },
      }),
    );
    mocks.resolveKeyVaultSecret.mockImplementation(async (secretReference) =>
      secretReference.secretName === "refresh-token"
        ? "vault-refresh-token"
        : "vault-client-secret",
    );
    mocks.executeHttpRequest.mockResolvedValue({
      statusCode: 200,
      rawBody: JSON.stringify({
        access_token: "new-access-token",
        expires_in: 3600,
      }),
    });

    await resolve();

    expect(mocks.executeHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          content: expect.stringContaining("refresh_token=vault-refresh-token"),
        }),
      }),
      expect.any(AbortSignal),
    );
    expect(mocks.saveCachedToken).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: null }),
    );
  });
});
