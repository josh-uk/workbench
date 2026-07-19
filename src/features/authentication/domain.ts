import { z } from "zod";

import { maskSecret } from "@/core/secrets/redaction";
import { keyVaultSecretReferenceSchema } from "@/features/authentication/azure/domain";
import { entityIdSchema, entityNameSchema } from "@/features/workspaces/domain";

export const authTypes = [
  "none",
  "bearer",
  "basic",
  "api_key_header",
  "api_key_query",
  "oauth2_client_credentials",
  "oauth2_password",
  "oauth2_refresh_token",
  "request_derived",
] as const;

export const authTypeSchema = z.enum(authTypes);
export type AuthType = (typeof authTypes)[number];

const configurationValue = z.string().max(8_192).default("");

export const authSecretFieldNames = [
  "token",
  "password",
  "key",
  "clientSecret",
  "refreshToken",
] as const;

export type AuthSecretField = (typeof authSecretFieldNames)[number];
export const authReferenceFieldNames = [
  ...authSecretFieldNames,
  "clientId",
] as const;
export type AuthReferenceField = (typeof authReferenceFieldNames)[number];

export const authSecretReferencesSchema = z
  .object({
    token: keyVaultSecretReferenceSchema.nullable().default(null),
    password: keyVaultSecretReferenceSchema.nullable().default(null),
    key: keyVaultSecretReferenceSchema.nullable().default(null),
    clientId: keyVaultSecretReferenceSchema.nullable().default(null),
    clientSecret: keyVaultSecretReferenceSchema.nullable().default(null),
    refreshToken: keyVaultSecretReferenceSchema.nullable().default(null),
  })
  .default({
    token: null,
    password: null,
    key: null,
    clientId: null,
    clientSecret: null,
    refreshToken: null,
  });

export const authProfileConfigurationSchema = z.object({
  token: configurationValue,
  username: configurationValue,
  password: configurationValue,
  key: configurationValue,
  headerName: configurationValue,
  queryName: configurationValue,
  tokenPrefix: configurationValue,
  tokenUrl: configurationValue,
  clientId: configurationValue,
  clientSecret: configurationValue,
  scope: configurationValue,
  audience: configurationValue,
  refreshToken: configurationValue,
  accessTokenJsonPath: configurationValue,
  refreshTokenJsonPath: configurationValue,
  expiresInJsonPath: configurationValue,
  tokenTypeJsonPath: configurationValue,
  outputName: configurationValue,
  injectionTarget: z.enum(["header", "query"]).default("header"),
  injectionName: configurationValue,
  failureBehavior: z.enum(["stop", "continue_without_auth"]).default("stop"),
  secretReferences: authSecretReferencesSchema,
});

export type AuthProfileConfiguration = z.infer<
  typeof authProfileConfigurationSchema
>;

export const saveAuthProfileSchema = z
  .object({
    id: entityIdSchema.optional(),
    workspaceId: entityIdSchema.nullable().default(null),
    projectId: entityIdSchema.nullable().default(null),
    tokenRequestId: entityIdSchema.nullable().default(null),
    name: entityNameSchema,
    type: authTypeSchema,
    configuration: authProfileConfigurationSchema,
  })
  .superRefine((value, context) => {
    if (
      Number(Boolean(value.workspaceId)) + Number(Boolean(value.projectId)) !==
      1
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Authentication profile must belong to one workspace or project.",
        path: ["workspaceId"],
      });
    }
  });

export const authProfileIdSchema = z.object({ authProfileId: entityIdSchema });

export const saveAuthOverrideSchema = z.object({
  authProfileId: entityIdSchema,
  projectId: entityIdSchema,
  configuration: authProfileConfigurationSchema.partial(),
});

export const authConfigurationQuerySchema = z.object({
  workspaceId: entityIdSchema,
  projectId: entityIdSchema.nullable().default(null),
});

export interface AuthProfileDetail {
  id: string;
  workspaceId: string | null;
  projectId: string | null;
  tokenRequestId: string | null;
  name: string;
  type: AuthType;
  configuration: AuthProfileConfiguration;
  inherited: boolean;
  overridden: boolean;
}

export interface AuthConfiguration {
  profiles: AuthProfileDetail[];
  tokenRequests: Array<{ id: string; projectId: string; name: string }>;
}

export interface EffectiveAuthProfile extends AuthProfileDetail {
  configuration: AuthProfileConfiguration;
}

export interface AuthenticationTrace {
  profileId: string;
  profileName: string;
  type: AuthType;
  source: "configured" | "cache" | "token_request" | "oauth_endpoint";
  injectedInto: string | null;
  credential: string;
}

export const AUTH_SECRET_PLACEHOLDER = maskSecret("secret");
export const authSecretFields = new Set<keyof AuthProfileConfiguration>(
  authSecretFieldNames,
);

export function referencedFieldsForAuthType(
  type: AuthType,
): AuthReferenceField[] {
  switch (type) {
    case "bearer":
      return ["token"];
    case "basic":
      return ["password"];
    case "api_key_header":
    case "api_key_query":
      return ["key"];
    case "oauth2_client_credentials":
      return ["clientId", "clientSecret"];
    case "oauth2_password":
      return ["clientId", "clientSecret", "password"];
    case "oauth2_refresh_token":
      return ["clientId", "clientSecret", "refreshToken"];
    default:
      return [];
  }
}

export function normaliseReferencedSecrets(
  configuration: AuthProfileConfiguration,
) {
  const result = structuredClone(configuration);
  for (const key of authReferenceFieldNames) {
    if (result.secretReferences[key]) result[key] = "";
  }
  return result;
}

export function defaultAuthConfiguration(): AuthProfileConfiguration {
  return authProfileConfigurationSchema.parse({
    tokenPrefix: "Bearer",
    headerName: "Authorization",
    queryName: "api_key",
    accessTokenJsonPath: "$.access_token",
    refreshTokenJsonPath: "$.refresh_token",
    expiresInJsonPath: "$.expires_in",
    tokenTypeJsonPath: "$.token_type",
    outputName: "accessToken",
    injectionTarget: "header",
    injectionName: "Authorization",
    failureBehavior: "stop",
  });
}

export function parseAuthConfiguration(value: unknown) {
  const parsed = authProfileConfigurationSchema.parse({
    ...defaultAuthConfiguration(),
    ...(value && typeof value === "object" ? value : {}),
  });
  return normaliseReferencedSecrets(parsed);
}

export class AuthDomainError extends Error {
  constructor(
    message: string,
    public readonly code = "AUTH_INVALID",
  ) {
    super(message);
    this.name = "AuthDomainError";
  }
}
