import { Buffer } from "node:buffer";

import {
  CollectionImportError,
  type PortableImportAuthProfile,
  type PortableImportPlan,
  type PortableImportRequest,
} from "../domain";
import {
  bodyFromText,
  defaultSettings,
  emptyBody,
  finalisePlan,
  normaliseMethod,
} from "./utils";

export function looksLikeRawHttp(input: string) {
  return /^\s*[A-Za-z]+\s+\S+\s+HTTP\/\d(?:\.\d)?\s*(?:\r?\n|$)/.test(input);
}

export function parseRawHttpRequest(input: string): PortableImportPlan {
  const boundary = input.match(/\r?\n\r?\n/);
  const boundaryIndex = boundary?.index ?? input.length;
  const head = input.slice(0, boundaryIndex).replace(/^\s+/, "");
  const bodyText = boundary
    ? input.slice(boundaryIndex + boundary[0].length)
    : "";
  const lines = head.split(/\r?\n/);
  const requestLine = lines
    .shift()
    ?.match(/^([A-Za-z]+)\s+(\S+)\s+HTTP\/(\d(?:\.\d)?)$/);
  if (!requestLine) {
    throw new CollectionImportError("The raw request line is invalid.");
  }
  const warnings: string[] = [];
  const method = normaliseMethod(requestLine[1], warnings);
  if (!method)
    throw new CollectionImportError("The raw HTTP method is unsupported.");
  const headers = [];
  const cookies: PortableImportRequest["settings"]["cookies"] = [];
  let host: string | null = null;
  let contentType: string | null = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (/^[ \t]/.test(line)) {
      throw new CollectionImportError(
        "Folded raw HTTP headers are not supported.",
      );
    }
    const separator = line.indexOf(":");
    if (separator < 1) {
      warnings.push(`Raw header line ${line} was ignored.`);
      continue;
    }
    const name = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (name.toLocaleLowerCase() === "host") {
      host = value;
      continue;
    }
    if (
      ["content-length", "connection", "transfer-encoding"].includes(
        name.toLocaleLowerCase(),
      )
    ) {
      warnings.push(`Managed header ${name} was not imported.`);
      continue;
    }
    if (name.toLocaleLowerCase() === "content-type") contentType = value;
    if (name.toLocaleLowerCase() === "cookie") {
      value.split(";").forEach((part) => {
        const cookieSeparator = part.indexOf("=");
        if (cookieSeparator > 0) {
          cookies.push({
            name: part.slice(0, cookieSeparator).trim(),
            value: part.slice(cookieSeparator + 1).trim(),
            enabled: true,
            secret: true,
          });
        }
      });
      continue;
    }
    headers.push({
      name,
      value,
      enabled: true,
      secret: /authorization|api[-_]?key|secret|token|password/i.test(name),
    });
  }
  const target = requestLine[2]!;
  const rawUrl = /^https?:\/\//i.test(target)
    ? target
    : host
      ? `https://${host}${target.startsWith("/") ? target : `/${target}`}`
      : null;
  if (!rawUrl) {
    throw new CollectionImportError(
      "A relative raw request target requires a Host header.",
    );
  }
  let url = rawUrl;
  const queryParameters: PortableImportRequest["queryParameters"] = [];
  try {
    const parsed = new URL(rawUrl);
    parsed.searchParams.forEach((value, name) => {
      queryParameters.push({
        name,
        value,
        enabled: true,
        secret: /secret|token|password|api[-_]?key/i.test(name),
      });
    });
    if (queryParameters.length) {
      parsed.search = "";
      url = parsed.toString();
    }
  } catch {
    warnings.push(
      "The raw request URL could not be decomposed into query fields.",
    );
  }

  const authProfiles: PortableImportAuthProfile[] = [];
  let authProfileKey: string | null = null;
  const authorizationIndex = headers.findIndex(
    ({ name }) => name.toLocaleLowerCase() === "authorization",
  );
  const authorization = headers[authorizationIndex];
  const bearer = authorization?.value.match(/^Bearer\s+(.+)$/i);
  const basic = authorization?.value.match(/^Basic\s+(.+)$/i);
  if (bearer) {
    authProfileKey = "raw-http:auth:bearer";
    authProfiles.push({
      sourceKey: authProfileKey,
      name: "Raw HTTP Bearer auth",
      type: "bearer",
      configuration: { token: bearer[1]!, tokenPrefix: "Bearer" },
    });
    headers.splice(authorizationIndex, 1);
  } else if (basic) {
    const credentials = Buffer.from(basic[1]!, "base64").toString("utf8");
    const separator = credentials.indexOf(":");
    authProfileKey = "raw-http:auth:basic";
    authProfiles.push({
      sourceKey: authProfileKey,
      name: "Raw HTTP Basic auth",
      type: "basic",
      configuration: {
        username: separator < 0 ? credentials : credentials.slice(0, separator),
        password: separator < 0 ? "" : credentials.slice(separator + 1),
      },
    });
    headers.splice(authorizationIndex, 1);
  }

  const path = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  })();
  const request = {
    sourceKey: "raw-http:request:1",
    name: `${method} ${path}`.slice(0, 120),
    description: `Imported from a raw HTTP/${requestLine[3]} request.`,
    folderPath: [],
    method,
    url,
    queryParameters,
    headers,
    requestVariables: [],
    body: bodyText ? bodyFromText(bodyText, contentType) : emptyBody(),
    settings: defaultSettings({ cookies }),
    authProfileKey,
    sourceMetadata: { httpVersion: requestLine[3] },
  };
  return finalisePlan(
    {
      format: "raw_http",
      formatVersion: requestLine[3] ?? null,
      name: request.name,
      requests: [request],
      environments: [],
      projectVariables: [],
      authProfiles,
      unsupported: [],
      warnings,
    },
    input,
  );
}
