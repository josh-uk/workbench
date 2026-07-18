import "server-only";

import http from "node:http";
import https from "node:https";

import {
  isCloudMetadataTarget,
  resolveAndValidateTarget,
} from "@/features/requests/execution/network-policy";

import {
  MAX_OPENAPI_DOCUMENT_BYTES,
  OpenApiDomainError,
  type OpenApiSourceType,
} from "./domain";

const SOURCE_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;

interface OpenApiSourceInput {
  sourceType: OpenApiSourceType;
  content?: string;
  sourceUrl?: string;
  allowPrivateNetwork: boolean;
}

async function requestSource(
  url: URL,
  allowPrivateNetwork: boolean,
  redirects = 0,
): Promise<string> {
  if (redirects > MAX_REDIRECTS) {
    throw new OpenApiDomainError(
      "The OpenAPI source redirected too many times.",
      "OPENAPI_SOURCE_REDIRECT_LIMIT",
    );
  }
  const target = await resolveAndValidateTarget(url, allowPrivateNetwork);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);

  try {
    return await new Promise<string>((resolve, reject) => {
      const request = (url.protocol === "https:" ? https : http).request(
        {
          protocol: url.protocol,
          hostname: target.address,
          port: url.port || (url.protocol === "https:" ? 443 : 80),
          path: `${url.pathname}${url.search}`,
          method: "GET",
          headers: {
            Accept:
              "application/vnd.oai.openapi+json, application/json, application/yaml, text/yaml, text/plain",
            Host: url.host,
            "User-Agent": "Workbench-OpenAPI-Importer/1",
          },
          signal: controller.signal,
          ...(url.protocol === "https:"
            ? { servername: target.hostname, rejectUnauthorized: true }
            : {}),
        },
        (response) => {
          const status = response.statusCode ?? 0;
          const location = response.headers.location;
          if (status >= 300 && status < 400 && location) {
            response.resume();
            let redirect: URL;
            try {
              redirect = new URL(location, url);
            } catch {
              reject(
                new OpenApiDomainError(
                  "The OpenAPI source returned an invalid redirect.",
                  "OPENAPI_SOURCE_REDIRECT_INVALID",
                ),
              );
              return;
            }
            requestSource(redirect, allowPrivateNetwork, redirects + 1).then(
              resolve,
              reject,
            );
            return;
          }
          if (status < 200 || status >= 300) {
            response.resume();
            reject(
              new OpenApiDomainError(
                `The OpenAPI source returned HTTP ${status}.`,
                "OPENAPI_SOURCE_HTTP_ERROR",
              ),
            );
            return;
          }
          const declaredLength = Number(
            response.headers["content-length"] ?? 0,
          );
          if (
            Number.isFinite(declaredLength) &&
            declaredLength > MAX_OPENAPI_DOCUMENT_BYTES
          ) {
            response.destroy();
            reject(
              new OpenApiDomainError(
                "The OpenAPI source is larger than 2 MiB.",
                "OPENAPI_SOURCE_SIZE_LIMIT",
              ),
            );
            return;
          }

          const chunks: Buffer[] = [];
          let size = 0;
          response.on("data", (chunk: Buffer) => {
            size += chunk.byteLength;
            if (size > MAX_OPENAPI_DOCUMENT_BYTES) {
              response.destroy(
                new OpenApiDomainError(
                  "The OpenAPI source is larger than 2 MiB.",
                  "OPENAPI_SOURCE_SIZE_LIMIT",
                ),
              );
              return;
            }
            chunks.push(chunk);
          });
          response.on("end", () =>
            resolve(Buffer.concat(chunks).toString("utf8")),
          );
          response.on("error", reject);
        },
      );
      request.on("error", (error) => {
        reject(
          error instanceof OpenApiDomainError
            ? error
            : new OpenApiDomainError(
                controller.signal.aborted
                  ? "The OpenAPI source request timed out."
                  : "The OpenAPI source could not be downloaded.",
                controller.signal.aborted
                  ? "OPENAPI_SOURCE_TIMEOUT"
                  : "OPENAPI_SOURCE_NETWORK_ERROR",
              ),
        );
      });
      request.end();
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function loadOpenApiSource(input: OpenApiSourceInput) {
  if (input.sourceType !== "url") {
    if (input.content !== undefined) return input.content;
    throw new OpenApiDomainError("The OpenAPI source content is missing.");
  }
  if (!input.sourceUrl) {
    throw new OpenApiDomainError("The OpenAPI source URL is missing.");
  }
  let url: URL;
  try {
    url = new URL(input.sourceUrl);
  } catch {
    throw new OpenApiDomainError(
      "The OpenAPI source URL is invalid.",
      "OPENAPI_SOURCE_URL_INVALID",
    );
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    isCloudMetadataTarget(url.hostname)
  ) {
    throw new OpenApiDomainError(
      "The OpenAPI source URL is not allowed.",
      "OPENAPI_SOURCE_URL_BLOCKED",
    );
  }
  if (input.content !== undefined) return input.content;
  return requestSource(url, input.allowPrivateNetwork);
}
