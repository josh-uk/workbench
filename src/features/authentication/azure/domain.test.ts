import { describe, expect, it } from "vitest";

import {
  azureLoginRequestSchema,
  keyVaultSecretReferenceSchema,
} from "./domain";

describe("Azure authentication domain", () => {
  it("accepts public Azure Key Vault references", () => {
    expect(
      keyVaultSecretReferenceSchema.parse({
        provider: "azure_key_vault",
        vaultUrl: "https://workbench-secrets.vault.azure.net/",
        secretName: "client-secret",
        version: "0123456789abcdef0123456789abcdef",
      }),
    ).toEqual({
      provider: "azure_key_vault",
      vaultUrl: "https://workbench-secrets.vault.azure.net/",
      secretName: "client-secret",
      version: "0123456789abcdef0123456789abcdef",
    });
  });

  it.each([
    "http://workbench-secrets.vault.azure.net/",
    "https://workbench-secrets.vault.azure.net:444/",
    "https://workbench-secrets.vault.azure.net/secrets",
    "https://workbench-secrets.vault.azure.net/?redirect=evil",
    "https://vault.example.test/",
    "https://workbench-secrets.vault.azure.net.evil.test/",
  ])("rejects unsafe vault URL %s", (vaultUrl) => {
    expect(() =>
      keyVaultSecretReferenceSchema.parse({
        provider: "azure_key_vault",
        vaultUrl,
        secretName: "client-secret",
      }),
    ).toThrow("public Azure Key Vault URL");
  });

  it("validates optional tenant identifiers", () => {
    expect(azureLoginRequestSchema.parse({})).toEqual({ tenant: "" });
    expect(
      azureLoginRequestSchema.parse({ tenant: "contoso.onmicrosoft.com" }),
    ).toEqual({ tenant: "contoso.onmicrosoft.com" });
    expect(() =>
      azureLoginRequestSchema.parse({ tenant: "not a tenant" }),
    ).toThrow("tenant ID or verified domain");
  });
});
