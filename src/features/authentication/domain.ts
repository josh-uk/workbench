import { z } from "zod";

import { maskSecret } from "@/core/secrets/redaction";
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
export const authSecretFields = new Set<keyof AuthProfileConfiguration>([
  "token",
  "password",
  "key",
  "clientSecret",
  "refreshToken",
]);

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
  return authProfileConfigurationSchema.parse({
    ...defaultAuthConfiguration(),
    ...(value && typeof value === "object" ? value : {}),
  });
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
