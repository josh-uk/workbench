import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { AzureAuthenticationError } from "./domain";

export function assertTrustedMutation(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new AzureAuthenticationError(
      "Azure requests must use JSON.",
      "AZURE_REQUEST_INVALID",
    );
  }
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (
    fetchSite === "cross-site" ||
    (origin && !requestOrigins(request).has(origin))
  ) {
    throw new AzureAuthenticationError(
      "Cross-origin Azure requests are not allowed.",
      "AZURE_REQUEST_FORBIDDEN",
    );
  }
}

function requestOrigins(request: Request) {
  const requestUrl = new URL(request.url);
  const origins = new Set([requestUrl.origin]);
  const host = request.headers.get("host");
  const forwardedHost = firstForwardedValue(
    request.headers.get("x-forwarded-host"),
  );
  const forwardedProtocol = firstForwardedValue(
    request.headers.get("x-forwarded-proto"),
  );

  addOrigin(origins, requestUrl.protocol, host);
  addOrigin(origins, forwardedProtocol, forwardedHost ?? host);
  return origins;
}

function firstForwardedValue(value: string | null) {
  return value?.split(",", 1)[0]?.trim() || null;
}

function addOrigin(
  origins: Set<string>,
  protocol: string | null,
  host: string | null,
) {
  const normalizedProtocol = protocol?.replace(/:$/, "");
  if (!normalizedProtocol || !host || !/^https?$/.test(normalizedProtocol)) {
    return;
  }
  try {
    origins.add(new URL(`${normalizedProtocol}://${host}`).origin);
  } catch {
    // Invalid forwarding metadata is never trusted as an allowed origin.
  }
}

export function azureErrorResponse(error: unknown) {
  const message =
    error instanceof ZodError
      ? (error.issues[0]?.message ?? "Azure configuration is invalid.")
      : error instanceof AzureAuthenticationError
        ? error.message
        : "Azure operation failed.";
  const status =
    error instanceof AzureAuthenticationError &&
    error.code === "AZURE_LOGIN_IN_PROGRESS"
      ? 409
      : error instanceof AzureAuthenticationError &&
          error.code === "AZURE_REQUEST_FORBIDDEN"
        ? 403
        : error instanceof AzureAuthenticationError &&
            error.code === "AZURE_CLI_UNAVAILABLE"
          ? 503
          : 400;
  return NextResponse.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export function azureJson(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return NextResponse.json(data, { ...init, headers });
}
