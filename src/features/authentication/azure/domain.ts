import { z } from "zod";

export const azureTenantIdSchema = z
  .string()
  .trim()
  .max(255)
  .refine(
    (value) =>
      !value ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value,
      ) ||
      /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value),
    "Tenant must be a tenant ID or verified domain.",
  );

export const azureLoginRequestSchema = z.object({
  tenant: azureTenantIdSchema.default(""),
});

export const keyVaultSecretReferenceSchema = z
  .object({
    provider: z.literal("azure_key_vault"),
    vaultUrl: z.string().trim().max(300),
    secretName: z
      .string()
      .trim()
      .min(1, "Secret name is required.")
      .max(127)
      .regex(
        /^[0-9A-Za-z-]+$/,
        "Secret name may contain letters, numbers, and hyphens only.",
      ),
    version: z
      .string()
      .trim()
      .max(64)
      .refine(
        (value) => !value || /^[0-9a-f]{32}$/i.test(value),
        "Secret version must be a 32-character hexadecimal version.",
      )
      .default(""),
  })
  .superRefine((value, context) => {
    let url: URL;
    try {
      url = new URL(value.vaultUrl);
    } catch {
      context.addIssue({
        code: "custom",
        path: ["vaultUrl"],
        message: "Vault URL must be a valid URL.",
      });
      return;
    }
    if (
      url.protocol !== "https:" ||
      url.port ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      !/^[a-z0-9](?:[a-z0-9-]{1,22}[a-z0-9])?\.vault\.azure\.net$/i.test(
        url.hostname,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["vaultUrl"],
        message:
          "Vault URL must be a public Azure Key Vault URL such as https://my-vault.vault.azure.net/.",
      });
    }
  });

export type KeyVaultSecretReference = z.infer<
  typeof keyVaultSecretReferenceSchema
>;

export const testKeyVaultReferenceSchema = z.object({
  reference: keyVaultSecretReferenceSchema,
});

export interface AzureAccountSummary {
  name: string;
  username: string;
  tenantId: string;
  subscriptionId: string;
}

export type AzureConnectionState =
  | { status: "disconnected"; cliAvailable: boolean }
  | {
      status: "starting" | "waiting";
      cliAvailable: true;
      verificationUrl: string | null;
      userCode: string | null;
      expiresAt: string;
    }
  | {
      status: "connected";
      cliAvailable: true;
      account: AzureAccountSummary;
    }
  | {
      status: "failed";
      cliAvailable: boolean;
      error: string;
    };

export class AzureAuthenticationError extends Error {
  constructor(
    message: string,
    public readonly code = "AZURE_AUTHENTICATION_FAILED",
  ) {
    super(message);
    this.name = "AzureAuthenticationError";
  }
}
