import { describe, expect, it } from "vitest";

import {
  defaultAuthConfiguration,
  parseAuthConfiguration,
  secretFieldsForAuthType,
} from "./domain";

describe("authentication secret references", () => {
  it("keeps existing profiles backward compatible", () => {
    const configuration = parseAuthConfiguration({ token: "local-token" });
    expect(configuration.token).toBe("local-token");
    expect(configuration.secretReferences).toEqual({
      token: null,
      password: null,
      key: null,
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

  it("resolves only fields used by each authentication type", () => {
    expect(secretFieldsForAuthType("bearer")).toEqual(["token"]);
    expect(secretFieldsForAuthType("oauth2_password")).toEqual([
      "clientSecret",
      "password",
    ]);
    expect(secretFieldsForAuthType("request_derived")).toEqual([]);
  });
});
