import { describe, expect, it } from "vitest";

import {
  defaultAuthConfiguration,
  parseAuthConfiguration,
  referencedFieldsForAuthType,
} from "./domain";

describe("authentication secret references", () => {
  it("keeps existing profiles backward compatible", () => {
    const configuration = parseAuthConfiguration({ token: "local-token" });
    expect(configuration.token).toBe("local-token");
    expect(configuration.secretReferences).toEqual({
      token: null,
      password: null,
      key: null,
      clientId: null,
      clientSecret: null,
      refreshToken: null,
    });
  });

  it("clears stored values when an Azure reference owns the field", () => {
    const configuration = parseAuthConfiguration({
      ...defaultAuthConfiguration(),
      clientSecret: "must-not-remain",
      secretReferences: {
        clientSecret: {
          provider: "azure_key_vault",
          vaultUrl: "https://workbench-secrets.vault.azure.net/",
          secretName: "oauth-secret",
          version: "",
        },
      },
    });
    expect(configuration.clientSecret).toBe("");
    expect(configuration.secretReferences.clientSecret?.secretName).toBe(
      "oauth-secret",
    );
  });

  it("clears a stored client ID when Key Vault owns it", () => {
    const configuration = parseAuthConfiguration({
      ...defaultAuthConfiguration(),
      clientId: "must-not-remain",
      secretReferences: {
        clientId: {
          provider: "azure_key_vault",
          vaultUrl: "https://workbench-secrets.vault.azure.net/",
          secretName: "oauth-client-id",
          version: "",
        },
      },
    });

    expect(configuration.clientId).toBe("");
    expect(configuration.secretReferences.clientId?.secretName).toBe(
      "oauth-client-id",
    );
  });

  it("resolves only fields used by each authentication type", () => {
    expect(referencedFieldsForAuthType("bearer")).toEqual(["token"]);
    expect(referencedFieldsForAuthType("oauth2_password")).toEqual([
      "clientId",
      "clientSecret",
      "password",
    ]);
    expect(referencedFieldsForAuthType("request_derived")).toEqual([]);
  });
});
