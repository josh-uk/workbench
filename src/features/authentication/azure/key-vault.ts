import "server-only";

import { z } from "zod";

import { getKeyVaultAccessToken } from "./azure-cli";
import {
  AzureAuthenticationError,
  type KeyVaultSecretReference,
  keyVaultSecretReferenceSchema,
} from "./domain";

const KEY_VAULT_API_VERSION = "2025-07-01";
const MAX_ERROR_BYTES = 4_096;
const keyVaultResponseSchema = z.object({ value: z.string().max(25_600) });
const keyVaultErrorSchema = z.object({
  error: z.object({
    code: z.string().max(100).optional(),
    innererror: z.object({ code: z.string().max(100).optional() }).optional(),
  }),
});

function secretUrl(reference: KeyVaultSecretReference) {
  const vault = reference.vaultUrl.endsWith("/")
    ? reference.vaultUrl
    : `${reference.vaultUrl}/`;
  const path = [
    "secrets",
    encodeURIComponent(reference.secretName),
    reference.version ? encodeURIComponent(reference.version) : null,
  ]
    .filter(Boolean)
    .join("/");
  return new URL(`${path}?api-version=${KEY_VAULT_API_VERSION}`, vault);
}

async function boundedErrorDetails(response: Response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (text.length < MAX_ERROR_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  try {
    const payload = keyVaultErrorSchema.parse(
      JSON.parse(text.slice(0, MAX_ERROR_BYTES)),
    );
    return [payload.error.code, payload.error.innererror?.code]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase();
  } catch {
    return "";
  }
}

async function failureForResponse(response: Response) {
  const details = await boundedErrorDetails(response);
  if (details === "secretdisabled" || details.includes(" secretdisabled")) {
    return new AzureAuthenticationError(
      "The requested Key Vault secret version is disabled.",
      "KEY_VAULT_SECRET_DISABLED",
    );
  }
  if (details === "secretexpired" || details.includes(" secretexpired")) {
    return new AzureAuthenticationError(
      "The requested Key Vault secret version has expired.",
      "KEY_VAULT_SECRET_EXPIRED",
    );
  }
  const status = response.status;
  if (status === 401) {
    return new AzureAuthenticationError(
      "Azure sign-in has expired. Reconnect Azure and try again.",
      "AZURE_RECONNECT_REQUIRED",
    );
  }
  if (status === 403) {
    return new AzureAuthenticationError(
      "The connected Azure user does not have permission to read this secret.",
      "KEY_VAULT_FORBIDDEN",
    );
  }
  if (status === 404) {
    return new AzureAuthenticationError(
      "The Key Vault secret or version was not found.",
      "KEY_VAULT_NOT_FOUND",
    );
  }
  if (status === 429) {
    return new AzureAuthenticationError(
      "Azure Key Vault is throttling requests. Try again shortly.",
      "KEY_VAULT_THROTTLED",
    );
  }
  return new AzureAuthenticationError(
    "Azure Key Vault could not resolve this secret.",
    "KEY_VAULT_FAILED",
  );
}

export async function resolveKeyVaultSecret(
  input: KeyVaultSecretReference,
  options: { signal?: AbortSignal } = {},
) {
  const reference = keyVaultSecretReferenceSchema.parse(input);
  const token = await getKeyVaultAccessToken();
  const timeout = AbortSignal.timeout(15_000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;
  let response: Response;
  try {
    response = await fetch(secretUrl(reference), {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `${token.tokenType} ${token.accessToken}`,
      },
      cache: "no-store",
      redirect: "error",
      signal,
    });
  } catch (error) {
    if (error instanceof AzureAuthenticationError) throw error;
    throw new AzureAuthenticationError(
      "Azure Key Vault could not be reached.",
      "KEY_VAULT_UNREACHABLE",
    );
  }
  if (!response.ok) throw await failureForResponse(response);
  try {
    const payload = keyVaultResponseSchema.parse(await response.json());
    if (!payload.value) {
      throw new AzureAuthenticationError(
        "Azure Key Vault returned an empty secret value.",
        "KEY_VAULT_EMPTY",
      );
    }
    return payload.value;
  } catch (error) {
    if (error instanceof AzureAuthenticationError) throw error;
    throw new AzureAuthenticationError(
      "Azure Key Vault returned an invalid secret response.",
      "KEY_VAULT_INVALID_RESPONSE",
    );
  }
}

export async function testKeyVaultSecretReference(
  reference: KeyVaultSecretReference,
) {
  await resolveKeyVaultSecret(reference);
  return { ok: true as const };
}
