import type { RequestPlan } from "@/features/requests/execution/http-engine";

import {
  type AuthenticationTrace,
  type EffectiveAuthProfile,
  AuthDomainError,
} from "./domain";

export interface AuthenticationCredential {
  value: string;
  prefix?: string;
  source: AuthenticationTrace["source"];
}

function required(value: string, label: string) {
  if (!value) throw new AuthDomainError(`${label} is required.`);
  return value;
}

function replaceHeader(plan: RequestPlan, name: string, value: string) {
  const lowerName = name.toLocaleLowerCase();
  return [
    ...plan.headers.filter(
      (header) => header.name.toLocaleLowerCase() !== lowerName,
    ),
    { name, value, enabled: true, secret: true },
  ];
}

function replaceQuery(plan: RequestPlan, name: string, value: string) {
  const lowerName = name.toLocaleLowerCase();
  return [
    ...plan.queryParameters.filter(
      (parameter) => parameter.name.toLocaleLowerCase() !== lowerName,
    ),
    { name, value, enabled: true, secret: true },
  ];
}

export function tokenIsFresh(expiresAt: Date | null, now = new Date()) {
  return !expiresAt || expiresAt.getTime() - now.getTime() > 30_000;
}

export function calculateTokenExpiry(
  expiresIn: unknown,
  now = new Date(),
): Date | null {
  if (expiresIn === null || expiresIn === undefined || expiresIn === "") {
    return null;
  }
  const seconds = Number(expiresIn);
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new AuthDomainError(
      "Token expiry must be a non-negative number.",
      "AUTH_EXPIRY_INVALID",
    );
  }
  return new Date(now.getTime() + seconds * 1_000);
}

export function injectAuthentication(
  plan: RequestPlan,
  profile: EffectiveAuthProfile,
  credential?: AuthenticationCredential,
): { plan: RequestPlan; trace: AuthenticationTrace } {
  const config = profile.configuration;
  let value = "";
  let target: "header" | "query" | null = null;
  let name = "";
  let source: AuthenticationTrace["source"] =
    credential?.source ?? "configured";

  switch (profile.type) {
    case "none":
      break;
    case "bearer":
      value = `${config.tokenPrefix || "Bearer"} ${required(config.token, "Bearer token")}`;
      target = "header";
      name = config.headerName || "Authorization";
      break;
    case "basic": {
      const username = required(config.username, "Username");
      const password = required(config.password, "Password");
      value = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
      target = "header";
      name = config.headerName || "Authorization";
      break;
    }
    case "api_key_header":
      value = required(config.key, "API key");
      target = "header";
      name = required(config.headerName, "Header name");
      break;
    case "api_key_query":
      value = required(config.key, "API key");
      target = "query";
      name = required(config.queryName, "Query parameter name");
      break;
    case "oauth2_client_credentials":
    case "oauth2_password":
    case "oauth2_refresh_token":
    case "request_derived": {
      const token = required(credential?.value ?? "", "Resolved access token");
      const prefix = credential?.prefix ?? config.tokenPrefix;
      value = prefix ? `${prefix} ${token}` : token;
      target = config.injectionTarget;
      name = required(config.injectionName, "Authentication injection name");
      source = credential?.source ?? "cache";
      break;
    }
  }

  const authenticatedPlan: RequestPlan = {
    ...plan,
    headers:
      target === "header" ? replaceHeader(plan, name, value) : plan.headers,
    queryParameters:
      target === "query"
        ? replaceQuery(plan, name, value)
        : plan.queryParameters,
    secretValues: value
      ? [...(plan.secretValues ?? []), value, credential?.value ?? ""].filter(
          Boolean,
        )
      : plan.secretValues,
  };

  return {
    plan: authenticatedPlan,
    trace: {
      profileId: profile.id,
      profileName: profile.name,
      type: profile.type,
      source,
      injectedInto: target ? `${target}:${name}` : null,
      credential: value ? "••••••••" : "",
    },
  };
}
