import http from "node:http";
import https from "node:https";

import { maskSecret } from "@/core/secrets/redaction";
import {
  type RedirectHop,
  type RequestBody,
  RequestDomainError,
  type RequestField,
  type RequestSettings,
  type ResponseCookie,
  type ResponseHeader,
  type SavedRequestDetail,
} from "@/features/requests/domain";

import { resolveAndValidateTarget } from "./network-policy";

const MAX_REQUEST_BYTES = 2 * 1_024 * 1_024;
const MAX_PERSISTED_PREVIEW_BYTES = 1_024 * 1_024;
const blockedRequestHeaders = new Set([
  "connection",
  "content-length",
  "host",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
const sensitiveResponseHeaders = new Set([
  "authorization",
  "cookie",
  "proxy-authenticate",
  "proxy-authorization",
  "set-cookie",
  "www-authenticate",
  "x-api-key",
]);
const sensitiveRequestHeaders = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
  "x-api-key",
  "api-key",
]);
const sensitiveQueryName =
  /(api[-_]?key|access[-_]?token|auth|password|secret|signature|token)/i;

export interface RequestPlan {
  id: string;
  projectId: string;
  method: SavedRequestDetail["method"];
  url: string;
  queryParameters: RequestField[];
  headers: RequestField[];
  body: RequestBody;
  settings: RequestSettings;
  secretValues?: string[];
}

export interface EngineResponse {
  statusCode: number;
  statusText: string;
  durationMs: number;
  sizeBytes: number;
  headers: ResponseHeader[];
  cookies: ResponseCookie[];
  redirects: RedirectHop[];
  bodyPreview: string;
  bodyTruncated: boolean;
  contentType: string | null;
  /** Server-only response text used for output extraction. Never persist or return it. */
  rawBody: string | null;
}

interface SerialisedBody {
  bytes: Buffer | null;
  contentType: string | null;
}

interface RawResponse {
  statusCode: number;
  statusText: string;
  headers: http.IncomingHttpHeaders;
  rawHeaders: string[];
  body: Buffer;
}

function redactKnownSecrets(value: string, secrets: readonly string[] = []) {
  return secrets.filter(Boolean).reduce(
    (redacted, secret) =>
      redacted
        .split(secret)
        .join(maskSecret(secret))
        .split(encodeURIComponent(secret))
        .join(encodeURIComponent(maskSecret(secret))),
    value,
  );
}

export function safeDisplayUrl(
  input: URL | string,
  secretValues: readonly string[] = [],
) {
  const url = typeof input === "string" ? new URL(input) : new URL(input.href);
  for (const key of url.searchParams.keys()) {
    if (sensitiveQueryName.test(key))
      url.searchParams.set(key, maskSecret("value"));
  }
  url.username = "";
  url.password = "";
  return redactKnownSecrets(url.toString(), secretValues);
}

function parseKeyValueLines(content: string) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map<[string, string]>((line) => {
      const separator = line.indexOf("=");
      return separator === -1
        ? [line, ""]
        : [line.slice(0, separator), line.slice(separator + 1)];
    });
}

function serialiseMultipart(
  content: string,
  metadata: Record<string, unknown>,
) {
  const boundary = `----workbench-${crypto.randomUUID()}`;
  let parts: Array<{
    name: string;
    value: string;
    filename?: string;
    contentType?: string;
    base64?: boolean;
  }>;
  try {
    parts = JSON.parse(content) as typeof parts;
    if (!Array.isArray(parts))
      throw new Error("Multipart body must be an array.");
  } catch {
    parts = parseKeyValueLines(content).map(([name, value]) => ({
      name,
      value,
    }));
  }

  const chunks: Buffer[] = [];
  for (const part of parts) {
    if (!part?.name || /[\r\n"]/.test(part.name)) {
      throw new RequestDomainError(
        "Multipart field name is invalid.",
        "BODY_INVALID",
      );
    }
    const filename =
      part.filename ??
      (typeof metadata.filename === "string" ? metadata.filename : undefined);
    if (filename && /[\r\n"]/.test(filename)) {
      throw new RequestDomainError(
        "Multipart filename is invalid.",
        "BODY_INVALID",
      );
    }
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(
      Buffer.from(
        `Content-Disposition: form-data; name="${part.name}"${filename ? `; filename="${filename}"` : ""}\r\n`,
      ),
    );
    if (part.contentType)
      chunks.push(Buffer.from(`Content-Type: ${part.contentType}\r\n`));
    chunks.push(Buffer.from("\r\n"));
    chunks.push(Buffer.from(part.value ?? "", part.base64 ? "base64" : "utf8"));
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    bytes: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

export function serialiseRequestBody(body: RequestBody): SerialisedBody {
  const content = body.content ?? "";
  switch (body.type) {
    case "none":
      return { bytes: null, contentType: null };
    case "json":
      try {
        JSON.parse(content);
      } catch {
        throw new RequestDomainError(
          "JSON request body is invalid.",
          "BODY_INVALID",
        );
      }
      return {
        bytes: Buffer.from(content),
        contentType: body.contentType || "application/json",
      };
    case "xml":
      return {
        bytes: Buffer.from(content),
        contentType: body.contentType || "application/xml",
      };
    case "text":
      return {
        bytes: Buffer.from(content),
        contentType: body.contentType || "text/plain; charset=utf-8",
      };
    case "form_urlencoded": {
      const parameters = new URLSearchParams(parseKeyValueLines(content));
      return {
        bytes: Buffer.from(parameters.toString()),
        contentType: body.contentType || "application/x-www-form-urlencoded",
      };
    }
    case "multipart":
      return serialiseMultipart(content, body.metadata);
    case "binary":
      return {
        bytes: Buffer.from(
          content,
          body.metadata.encoding === "base64" ? "base64" : "utf8",
        ),
        contentType: body.contentType || "application/octet-stream",
      };
  }
}

function buildTargetUrl(plan: RequestPlan) {
  let url: URL;
  try {
    url = new URL(plan.url);
  } catch {
    throw new RequestDomainError("Request URL is invalid.", "URL_INVALID");
  }
  for (const parameter of plan.queryParameters) {
    if (parameter.enabled)
      url.searchParams.append(parameter.name, parameter.value);
  }
  return url;
}

function buildHeaders(plan: RequestPlan, body: SerialisedBody) {
  const headers: Record<string, string> = {};
  for (const header of plan.headers) {
    if (!header.enabled) continue;
    const name = header.name.trim();
    const lower = name.toLocaleLowerCase();
    if (blockedRequestHeaders.has(lower)) {
      throw new RequestDomainError(
        `The ${name} header is managed by Workbench and cannot be overridden.`,
        "HEADER_BLOCKED",
      );
    }
    try {
      http.validateHeaderName(name);
      http.validateHeaderValue(name, header.value);
    } catch {
      throw new RequestDomainError(
        `The ${name} header is invalid.`,
        "HEADER_INVALID",
      );
    }
    headers[name] = headers[name]
      ? `${headers[name]}, ${header.value}`
      : header.value;
  }

  const cookies = plan.settings.cookies
    .filter((cookie) => cookie.enabled)
    .map(
      (cookie) =>
        `${encodeURIComponent(cookie.name)}=${encodeURIComponent(cookie.value)}`,
    )
    .join("; ");
  if (cookies) headers.Cookie = cookies;
  if (
    body.contentType &&
    !Object.keys(headers).some((name) => name.toLowerCase() === "content-type")
  ) {
    headers["Content-Type"] = body.contentType;
  }
  if (body.bytes) headers["Content-Length"] = String(body.bytes.byteLength);
  return headers;
}

export function createRequestSnapshot(plan: RequestPlan) {
  const url = buildTargetUrl(plan);
  return {
    method: plan.method,
    url: safeDisplayUrl(url, plan.secretValues),
    headers: plan.headers
      .filter((header) => header.enabled)
      .map((header) => ({
        name: header.name,
        value:
          header.secret ||
          sensitiveRequestHeaders.has(header.name.toLocaleLowerCase())
            ? maskSecret(header.value)
            : header.value,
      })),
    cookies: plan.settings.cookies
      .filter((cookie) => cookie.enabled)
      .map((cookie) => ({
        name: cookie.name,
        value: maskSecret(cookie.value),
      })),
    body: {
      type: plan.body.type,
      contentType: plan.body.contentType,
      sizeBytes: Buffer.byteLength(plan.body.content ?? ""),
    },
    settings: {
      timeoutMs: plan.settings.timeoutMs,
      followRedirects: plan.settings.followRedirects,
      maxRedirects: plan.settings.maxRedirects,
      tlsVerify: plan.settings.tlsVerify,
      maxResponseBytes: plan.settings.maxResponseBytes,
      allowPrivateNetwork: plan.settings.allowPrivateNetwork,
    },
  };
}

function requestOnce(
  url: URL,
  method: string,
  headers: Record<string, string>,
  body: Buffer | null,
  settings: RequestSettings,
  signal: AbortSignal,
): Promise<RawResponse> {
  return resolveAndValidateTarget(url, settings.allowPrivateNetwork).then(
    (target) =>
      new Promise((resolve, reject) => {
        const options = {
          protocol: url.protocol,
          hostname: target.address,
          port: url.port || (url.protocol === "https:" ? 443 : 80),
          path: `${url.pathname}${url.search}`,
          method,
          headers: { ...headers, Host: url.host },
          signal,
          ...(url.protocol === "https:"
            ? {
                servername: target.hostname,
                rejectUnauthorized: settings.tlsVerify,
              }
            : {}),
        };
        const request = (url.protocol === "https:" ? https : http).request(
          options,
          (response) => {
            const chunks: Buffer[] = [];
            let size = 0;
            response.on("data", (chunk: Buffer) => {
              size += chunk.byteLength;
              if (size > settings.maxResponseBytes) {
                response.destroy(
                  new RequestDomainError(
                    `Response exceeded the ${settings.maxResponseBytes.toLocaleString()} byte limit.`,
                    "RESPONSE_TOO_LARGE",
                  ),
                );
                return;
              }
              chunks.push(chunk);
            });
            response.on("end", () =>
              resolve({
                statusCode: response.statusCode ?? 0,
                statusText: response.statusMessage ?? "",
                headers: response.headers,
                rawHeaders: response.rawHeaders,
                body: Buffer.concat(chunks),
              }),
            );
            response.on("error", reject);
          },
        );
        request.on("error", reject);
        if (body) request.write(body);
        request.end();
      }),
  );
}

function responseHeaders(
  rawHeaders: string[],
  secretValues: readonly string[] = [],
): ResponseHeader[] {
  const result: ResponseHeader[] = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index] ?? "";
    const value = rawHeaders[index + 1] ?? "";
    result.push({
      name,
      value: sensitiveResponseHeaders.has(name.toLocaleLowerCase())
        ? maskSecret(value)
        : redactKnownSecrets(value, secretValues),
    });
  }
  return result;
}

function responseCookies(headers: http.IncomingHttpHeaders): ResponseCookie[] {
  const values = headers["set-cookie"] ?? [];
  return values.map((cookie) => {
    const [pair = "", ...attributes] = cookie
      .split(";")
      .map((item) => item.trim());
    const separator = pair.indexOf("=");
    return {
      name: separator === -1 ? pair : pair.slice(0, separator),
      value: maskSecret(separator === -1 ? "" : pair.slice(separator + 1)),
      attributes,
    };
  });
}

function isTextContent(contentType: string | null) {
  return Boolean(
    contentType &&
    (/^text\//i.test(contentType) ||
      /(json|xml|javascript|svg|x-www-form-urlencoded)/i.test(contentType)),
  );
}

function redactResponseText(value: string, plan: RequestPlan) {
  const secrets = [
    ...(plan.secretValues ?? []),
    ...plan.headers
      .filter(
        (header) =>
          header.enabled &&
          (header.secret ||
            sensitiveRequestHeaders.has(header.name.toLocaleLowerCase())),
      )
      .map((header) => header.value),
    ...plan.settings.cookies
      .filter((cookie) => cookie.enabled)
      .map((cookie) => cookie.value),
    ...plan.queryParameters
      .filter(
        (parameter) =>
          parameter.enabled && sensitiveQueryName.test(parameter.name),
      )
      .map((parameter) => parameter.value),
  ].filter((secret) => secret.length >= 3);

  return secrets.reduce(
    (redacted, secret) => redacted.split(secret).join(maskSecret(secret)),
    value,
  );
}

function redirectMethod(status: number, method: string) {
  if (status === 303 && method !== "HEAD") return "GET";
  if ((status === 301 || status === 302) && method === "POST") return "GET";
  return method;
}

export async function executeHttpRequest(
  plan: RequestPlan,
  externalSignal: AbortSignal,
): Promise<EngineResponse> {
  const started = performance.now();
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort(externalSignal.reason);
  if (externalSignal.aborted) cancel();
  else externalSignal.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("Request timed out."));
  }, plan.settings.timeoutMs);

  try {
    let currentUrl = buildTargetUrl(plan);
    let method: string = plan.method;
    const serialisedBody = serialiseRequestBody(plan.body);
    if ((serialisedBody.bytes?.byteLength ?? 0) > MAX_REQUEST_BYTES) {
      throw new RequestDomainError(
        "Request body exceeds the 2 MiB limit.",
        "REQUEST_TOO_LARGE",
      );
    }
    const headers = buildHeaders(plan, serialisedBody);
    let body = serialisedBody.bytes;
    const redirects: RedirectHop[] = [];
    let response: RawResponse | null = null;

    while (true) {
      response = await requestOnce(
        currentUrl,
        method,
        headers,
        body,
        plan.settings,
        controller.signal,
      );
      const location = response.headers.location;
      const redirect = [301, 302, 303, 307, 308].includes(response.statusCode);
      if (!redirect || !location || !plan.settings.followRedirects) break;
      if (redirects.length >= plan.settings.maxRedirects) {
        throw new RequestDomainError(
          `Request exceeded the ${plan.settings.maxRedirects} redirect limit.`,
          "TOO_MANY_REDIRECTS",
        );
      }

      const nextUrl = new URL(location, currentUrl);
      await resolveAndValidateTarget(
        nextUrl,
        plan.settings.allowPrivateNetwork,
      );
      redirects.push({
        statusCode: response.statusCode,
        url: safeDisplayUrl(currentUrl, plan.secretValues),
        location: safeDisplayUrl(nextUrl, plan.secretValues),
      });
      const nextMethod = redirectMethod(response.statusCode, method);
      if (nextMethod === "GET" && method !== "GET") {
        body = null;
        delete headers["Content-Length"];
        delete headers["Content-Type"];
      }
      method = nextMethod;
      currentUrl = nextUrl;
    }

    if (!response)
      throw new RequestDomainError("No response was received.", "NO_RESPONSE");
    const contentType = Array.isArray(response.headers["content-type"])
      ? (response.headers["content-type"][0] ?? null)
      : (response.headers["content-type"] ?? null);
    const previewBytes = response.body.subarray(0, MAX_PERSISTED_PREVIEW_BYTES);
    const text = isTextContent(contentType);
    const rawBody = text ? response.body.toString("utf8") : null;

    return {
      statusCode: response.statusCode,
      statusText: response.statusText,
      durationMs: Math.max(0, Math.round(performance.now() - started)),
      sizeBytes: response.body.byteLength,
      headers: responseHeaders(response.rawHeaders, plan.secretValues),
      cookies: responseCookies(response.headers),
      redirects,
      bodyPreview: text
        ? redactResponseText(previewBytes.toString("utf8"), plan)
        : previewBytes.toString("base64"),
      bodyTruncated: response.body.byteLength > previewBytes.byteLength,
      contentType,
      rawBody,
    };
  } catch (error) {
    if (externalSignal.aborted) {
      throw new RequestDomainError(
        "Request was cancelled.",
        "REQUEST_CANCELLED",
      );
    }
    if (timedOut) {
      throw new RequestDomainError(
        `Request timed out after ${plan.settings.timeoutMs} ms.`,
        "REQUEST_TIMEOUT",
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    externalSignal.removeEventListener("abort", cancel);
  }
}
