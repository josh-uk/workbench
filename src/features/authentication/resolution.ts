import "server-only";

import {
  evaluateJsonPath,
  outputValueToString,
} from "@/core/request-outputs/json-path";
import {
  getCachedToken,
  getEffectiveAuthProfile,
  saveCachedToken,
} from "@/features/authentication/data/auth-repository";
import {
  type AuthenticationTrace,
  type AuthProfileConfiguration,
  AuthDomainError,
  type EffectiveAuthProfile,
  parseAuthConfiguration,
  secretFieldsForAuthType,
} from "@/features/authentication/domain";
import { resolveKeyVaultSecret } from "@/features/authentication/azure/key-vault";
import { AzureAuthenticationError } from "@/features/authentication/azure/domain";
import {
  calculateTokenExpiry,
  injectAuthentication,
  tokenIsFresh,
} from "@/features/authentication/injection";
import { getLatestRequestOutput } from "@/features/request-outputs/data/request-output-repository";
import {
  executeHttpRequest,
  type RequestPlan,
} from "@/features/requests/execution/http-engine";
import {
  createVariableResolver,
  type VariableDefinition,
} from "@/features/variables/domain";

function interpolateConfiguration(
  profile: EffectiveAuthProfile,
  definitions: VariableDefinition[],
): EffectiveAuthProfile {
  const resolver = createVariableResolver(definitions);
  const configuration = { ...profile.configuration };
  for (const [key, value] of Object.entries(configuration) as Array<
    [
      keyof AuthProfileConfiguration,
      AuthProfileConfiguration[keyof AuthProfileConfiguration],
    ]
  >) {
    if (typeof value !== "string" || !value) continue;
    const resolved = resolver.interpolate(value);
    if (resolved.errors.length || resolved.unresolved.length) {
      throw new AuthDomainError(
        `Authentication field ${key} could not be resolved.`,
        "AUTH_VARIABLE_UNRESOLVED",
      );
    }
    Object.assign(configuration, { [key]: resolved.value });
  }
  return { ...profile, configuration: parseAuthConfiguration(configuration) };
}

async function resolveReferencedSecrets(
  profile: EffectiveAuthProfile,
  signal: AbortSignal,
  fields = secretFieldsForAuthType(profile.type),
): Promise<EffectiveAuthProfile> {
  const configuration = structuredClone(profile.configuration);
  for (const key of fields) {
    const reference = configuration.secretReferences[key];
    if (reference) {
      configuration[key] = await resolveKeyVaultSecret(reference, { signal });
    }
  }
  return { ...profile, configuration };
}

function formContent(values: Record<string, string>) {
  return Object.entries(values)
    .filter(([, value]) => Boolean(value))
    .map(([name, value]) => `${name}=${value}`)
    .join("\n");
}

function jsonPathValue(
  document: unknown,
  path: string,
  label: string,
  required: boolean,
) {
  if (!path) {
    if (required) throw new AuthDomainError(`${label} JSONPath is required.`);
    return null;
  }
  const value = evaluateJsonPath(document, path);
  if (value === undefined || value === null || value === "") {
    if (required) {
      throw new AuthDomainError(
        `${label} was not present in the token response.`,
        "AUTH_TOKEN_EXTRACTION_FAILED",
      );
    }
    return null;
  }
  return outputValueToString(value);
}

async function requestOAuthToken(
  profile: EffectiveAuthProfile,
  sourcePlan: RequestPlan,
  signal: AbortSignal,
  cached: Awaited<ReturnType<typeof getCachedToken>>,
) {
  const config = profile.configuration;
  const grantType = cached?.refreshToken
    ? "refresh_token"
    : profile.type === "oauth2_password"
      ? "password"
      : profile.type === "oauth2_refresh_token"
        ? "refresh_token"
        : "client_credentials";
  const fields: Record<string, string> = {
    grant_type: grantType,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: config.scope,
    audience: config.audience,
  };
  if (grantType === "password") {
    fields.username = config.username;
    fields.password = config.password;
  }
  if (grantType === "refresh_token") {
    fields.refresh_token = cached?.refreshToken || config.refreshToken;
    if (!fields.refresh_token) {
      throw new AuthDomainError(
        "Refresh token is required.",
        "AUTH_REFRESH_TOKEN_MISSING",
      );
    }
  }
  if (!config.tokenUrl)
    throw new AuthDomainError("OAuth token URL is required.");
  if (!config.clientId)
    throw new AuthDomainError("OAuth client ID is required.");

  const response = await executeHttpRequest(
    {
      id: `oauth:${profile.id}`,
      projectId: sourcePlan.projectId,
      method: "POST",
      url: config.tokenUrl,
      queryParameters: [],
      headers: [],
      body: {
        type: "form_urlencoded",
        content: formContent(fields),
        contentType: "application/x-www-form-urlencoded",
        metadata: {},
      },
      settings: sourcePlan.settings,
      secretValues: [
        config.clientSecret,
        fields.password ?? "",
        fields.refresh_token ?? "",
      ].filter(Boolean),
    },
    signal,
  );
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new AuthDomainError(
      `OAuth token endpoint returned ${response.statusCode}.`,
      "AUTH_TOKEN_REQUEST_FAILED",
    );
  }
  if (!response.rawBody) {
    throw new AuthDomainError("OAuth token endpoint did not return JSON.");
  }
  let document: unknown;
  try {
    document = JSON.parse(response.rawBody) as unknown;
  } catch {
    throw new AuthDomainError("OAuth token response is not valid JSON.");
  }
  const accessToken = jsonPathValue(
    document,
    config.accessTokenJsonPath,
    "Access token",
    true,
  ) as string;
  const refreshToken =
    jsonPathValue(
      document,
      config.refreshTokenJsonPath,
      "Refresh token",
      false,
    ) ??
    cached?.refreshToken ??
    (config.secretReferences.refreshToken ? null : config.refreshToken) ??
    null;
  const expiresIn = jsonPathValue(
    document,
    config.expiresInJsonPath,
    "Token expiry",
    false,
  );
  const tokenType =
    jsonPathValue(document, config.tokenTypeJsonPath, "Token type", false) ||
    config.tokenPrefix ||
    "Bearer";
  const expiresAt = calculateTokenExpiry(expiresIn);
  await saveCachedToken({
    authProfileId: profile.id,
    projectId: sourcePlan.projectId,
    accessToken,
    refreshToken,
    tokenType,
    expiresAt,
  });
  return { accessToken, tokenType, source: "oauth_endpoint" as const };
}

export async function resolveAuthentication(input: {
  authProfileId: string | null;
  projectId: string;
  plan: RequestPlan;
  variableDefinitions: VariableDefinition[];
  signal: AbortSignal;
  executeTokenRequest: (requestId: string) => Promise<void>;
}): Promise<{ plan: RequestPlan; trace: AuthenticationTrace | null }> {
  if (!input.authProfileId) return { plan: input.plan, trace: null };
  let profile = interpolateConfiguration(
    await getEffectiveAuthProfile(input.authProfileId, input.projectId),
    input.variableDefinitions,
  );

  try {
    if (
      profile.type !== "oauth2_client_credentials" &&
      profile.type !== "oauth2_password" &&
      profile.type !== "oauth2_refresh_token" &&
      profile.type !== "request_derived"
    ) {
      profile = await resolveReferencedSecrets(profile, input.signal);
      return injectAuthentication(input.plan, profile);
    }

    if (profile.type === "request_derived") {
      if (!profile.tokenRequestId) {
        throw new AuthDomainError(
          "Request-derived profile needs a token request.",
        );
      }
      const outputName = profile.configuration.outputName || "accessToken";
      let output = await getLatestRequestOutput(
        profile.tokenRequestId,
        outputName,
      );
      let source: "cache" | "token_request" = "cache";
      if (!output) {
        await input.executeTokenRequest(profile.tokenRequestId);
        output = await getLatestRequestOutput(
          profile.tokenRequestId,
          outputName,
        );
        source = "token_request";
      }
      if (!output) {
        throw new AuthDomainError(
          `Token request did not publish output ${outputName}.`,
          "AUTH_TOKEN_OUTPUT_MISSING",
        );
      }
      return injectAuthentication(input.plan, profile, {
        value: output.value,
        prefix: profile.configuration.tokenPrefix,
        source,
      });
    }

    const cached = await getCachedToken(profile.id, input.projectId);
    if (cached && tokenIsFresh(cached.expiresAt)) {
      return injectAuthentication(input.plan, profile, {
        value: cached.accessToken,
        prefix: cached.tokenType,
        source: "cache",
      });
    }
    const usesCachedRefreshToken = Boolean(cached?.refreshToken);
    const neededSecretFields = [
      "clientSecret" as const,
      ...(!usesCachedRefreshToken && profile.type === "oauth2_password"
        ? (["password"] as const)
        : []),
      ...(!usesCachedRefreshToken && profile.type === "oauth2_refresh_token"
        ? (["refreshToken"] as const)
        : []),
    ];
    profile = await resolveReferencedSecrets(
      profile,
      input.signal,
      neededSecretFields,
    );
    const token = await requestOAuthToken(
      profile,
      input.plan,
      input.signal,
      cached,
    );
    return injectAuthentication(input.plan, profile, {
      value: token.accessToken,
      prefix: token.tokenType,
      source: token.source,
    });
  } catch (error) {
    if (profile.configuration.failureBehavior === "continue_without_auth") {
      return {
        plan: input.plan,
        trace: {
          profileId: profile.id,
          profileName: profile.name,
          type: profile.type,
          source: "configured",
          injectedInto: null,
          credential: "",
        },
      };
    }
    if (error instanceof AzureAuthenticationError) {
      throw new AuthDomainError(error.message, error.code);
    }
    throw error;
  }
}
