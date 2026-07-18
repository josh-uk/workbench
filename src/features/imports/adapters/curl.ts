import { Buffer } from "node:buffer";

import {
  CollectionImportError,
  type PortableImportAuthProfile,
  type PortableImportPlan,
} from "../domain";
import {
  bodyFromText,
  defaultSettings,
  emptyBody,
  finalisePlan,
  normaliseMethod,
} from "./utils";
import { parseShellWords } from "./shell-words";

function optionValue(token: string, longName: string, shortName: string) {
  if (token.startsWith(`${longName}=`)) return token.slice(longName.length + 1);
  if (token.startsWith(shortName) && token !== shortName) {
    return token.slice(shortName.length);
  }
  return null;
}

function headerField(value: string) {
  const separator = value.indexOf(":");
  if (separator < 1) return null;
  const name = value.slice(0, separator).trim();
  const headerValue = value.slice(separator + 1).trim();
  return {
    name,
    value: headerValue,
    enabled: headerValue !== "",
    secret: /authorization|api[-_]?key|secret|token|password/i.test(name),
  };
}

function requestName(method: string, url: string) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? parsed.hostname : parsed.pathname;
    return `${method} ${path}`.slice(0, 120);
  } catch {
    return `${method} ${url}`.slice(0, 120);
  }
}

export function looksLikeCurl(input: string) {
  return /^\s*(?:\$\s*)?curl(?:\s|$)/i.test(input);
}

export function parseCurlCommand(input: string): PortableImportPlan {
  const tokens = parseShellWords(input);
  if (tokens[0] === "$") tokens.shift();
  if (tokens.shift()?.toLocaleLowerCase() !== "curl") {
    throw new CollectionImportError("The command must start with curl.");
  }
  const warnings: string[] = [];
  const unsupported: string[] = [];
  const headers = [];
  const data: string[] = [];
  const forms: Array<{ name: string; value: string }> = [];
  const cookies: Array<{
    name: string;
    value: string;
    enabled: boolean;
    secret: boolean;
  }> = [];
  const authProfiles: PortableImportAuthProfile[] = [];
  const urls: string[] = [];
  let method: string | null = null;
  let user: string | null = null;
  let followRedirects = false;
  let tlsVerify = true;
  let timeoutMs: number | undefined;
  let useGet = false;
  let head = false;
  let json = false;
  let uploadFile: string | null = null;

  const takeNext = (index: number, option: string) => {
    const value = tokens[index + 1];
    if (value === undefined) {
      throw new CollectionImportError(
        `cURL option ${option} requires a value.`,
      );
    }
    return value;
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const requestOption = optionValue(token, "--request", "-X");
    if (requestOption !== null || token === "--request" || token === "-X") {
      method = requestOption ?? takeNext(index, token);
      if (requestOption === null) index += 1;
      continue;
    }
    const headerOption = optionValue(token, "--header", "-H");
    if (headerOption !== null || token === "--header" || token === "-H") {
      const value = headerOption ?? takeNext(index, token);
      if (headerOption === null) index += 1;
      const header = headerField(value);
      if (header) headers.push(header);
      else warnings.push(`cURL header ${value} was not understood.`);
      continue;
    }
    const userAgentOption = optionValue(token, "--user-agent", "-A");
    if (
      userAgentOption !== null ||
      token === "--user-agent" ||
      token === "-A"
    ) {
      const value = userAgentOption ?? takeNext(index, token);
      if (userAgentOption === null) index += 1;
      headers.push({
        name: "User-Agent",
        value,
        enabled: true,
        secret: false,
      });
      continue;
    }
    const refererOption = optionValue(token, "--referer", "-e");
    if (refererOption !== null || token === "--referer" || token === "-e") {
      const value = refererOption ?? takeNext(index, token);
      if (refererOption === null) index += 1;
      headers.push({ name: "Referer", value, enabled: true, secret: false });
      continue;
    }
    const jsonOption = token.startsWith("--json=")
      ? token.slice("--json=".length)
      : null;
    if (jsonOption !== null || token === "--json") {
      let value = jsonOption ?? takeNext(index, token);
      if (jsonOption === null) index += 1;
      if (value.startsWith("@")) {
        unsupported.push(
          `cURL JSON file ${value.slice(1)} was not read; reselect its content after import.`,
        );
        value = `[file:${value.slice(1)}]`;
      }
      data.push(value);
      json = true;
      continue;
    }
    const dataNames = [
      "--data",
      "--data-raw",
      "--data-binary",
      "--data-ascii",
      "--data-urlencode",
    ];
    const dataName = dataNames.find(
      (name) => token === name || token.startsWith(`${name}=`),
    );
    const shortData =
      token === "-d" || (token.startsWith("-d") && token.length > 2);
    if (dataName || shortData) {
      const attached = dataName
        ? token.startsWith(`${dataName}=`)
          ? token.slice(dataName.length + 1)
          : null
        : token.length > 2
          ? token.slice(2)
          : null;
      let value = attached ?? takeNext(index, token);
      if (attached === null) index += 1;
      if (value.startsWith("@")) {
        unsupported.push(
          `cURL data file ${value.slice(1)} was not read; reselect its content after import.`,
        );
        value = `[file:${value.slice(1)}]`;
      }
      data.push(value);
      continue;
    }
    const formOption = optionValue(token, "--form", "-F");
    if (formOption !== null || token === "--form" || token === "-F") {
      const value = formOption ?? takeNext(index, token);
      if (formOption === null) index += 1;
      const separator = value.indexOf("=");
      if (separator > 0) {
        const name = value.slice(0, separator);
        let fieldValue = value.slice(separator + 1);
        if (fieldValue.startsWith("@")) {
          unsupported.push(
            `cURL form file ${fieldValue.slice(1)} requires reselection after import.`,
          );
          fieldValue = `[file:${fieldValue.slice(1)}]`;
        }
        forms.push({ name, value: fieldValue });
      }
      continue;
    }
    const uploadOption = optionValue(token, "--upload-file", "-T");
    if (uploadOption !== null || token === "--upload-file" || token === "-T") {
      uploadFile = uploadOption ?? takeNext(index, token);
      if (uploadOption === null) index += 1;
      unsupported.push(
        `cURL upload file ${uploadFile} requires reselection after import.`,
      );
      continue;
    }
    const userOption = optionValue(token, "--user", "-u");
    if (userOption !== null || token === "--user" || token === "-u") {
      user = userOption ?? takeNext(index, token);
      if (userOption === null) index += 1;
      continue;
    }
    const cookieOption = optionValue(token, "--cookie", "-b");
    if (cookieOption !== null || token === "--cookie" || token === "-b") {
      const value = cookieOption ?? takeNext(index, token);
      if (cookieOption === null) index += 1;
      if (value.startsWith("@")) {
        unsupported.push(`cURL cookie file ${value.slice(1)} was not read.`);
      } else {
        value.split(";").forEach((part) => {
          const separator = part.indexOf("=");
          if (separator > 0) {
            cookies.push({
              name: part.slice(0, separator).trim(),
              value: part.slice(separator + 1).trim(),
              enabled: true,
              secret: true,
            });
          }
        });
      }
      continue;
    }
    const timeoutOption = optionValue(token, "--max-time", "-m");
    if (timeoutOption !== null || token === "--max-time" || token === "-m") {
      const value = timeoutOption ?? takeNext(index, token);
      if (timeoutOption === null) index += 1;
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds > 0) {
        timeoutMs = Math.min(Math.round(seconds * 1_000), 120_000);
      }
      continue;
    }
    if (token === "--url") {
      urls.push(takeNext(index, token));
      index += 1;
      continue;
    }
    if (
      token === "--config" ||
      token === "-K" ||
      token.startsWith("--config=")
    ) {
      throw new CollectionImportError(
        "cURL config files are not read during import. Paste the expanded command instead.",
        "IMPORT_FILE_REFERENCE_BLOCKED",
      );
    }
    if (token === "--location" || token === "-L") {
      followRedirects = true;
      continue;
    }
    if (token === "--insecure" || token === "-k") {
      tlsVerify = false;
      continue;
    }
    if (token === "--get" || token === "-G") {
      useGet = true;
      continue;
    }
    if (token === "--head" || token === "-I") {
      head = true;
      continue;
    }
    const ignoredValueOption = [
      ["--output", "-o"],
      ["--proxy", "-x"],
      ["--cert", "-E"],
      ["--key", ""],
      ["--cacert", ""],
      ["--cookie-jar", "-c"],
      ["--resolve", ""],
      ["--connect-timeout", ""],
      ["--request-target", ""],
      ["--retry", ""],
      ["--limit-rate", ""],
    ].find(
      ([longName, shortName]) =>
        token === longName ||
        token.startsWith(`${longName}=`) ||
        (shortName &&
          (token === shortName ||
            (token.startsWith(shortName) && token !== shortName))),
    );
    if (ignoredValueOption) {
      const [longName, shortName] = ignoredValueOption;
      const attached = token.startsWith(`${longName}=`)
        ? token.slice(longName.length + 1)
        : shortName && token.startsWith(shortName) && token !== shortName
          ? token.slice(shortName.length)
          : null;
      if (attached === null) {
        takeNext(index, token);
        index += 1;
      }
      warnings.push(`cURL option ${token} was not imported.`);
      continue;
    }
    if (/^-[kLIG]+$/.test(token)) {
      followRedirects ||= token.includes("L");
      tlsVerify &&= !token.includes("k");
      useGet ||= token.includes("G");
      head ||= token.includes("I");
      continue;
    }
    if (token.startsWith("-")) {
      warnings.push(`cURL option ${token} was ignored.`);
      continue;
    }
    urls.push(token);
  }

  if (urls.length !== 1) {
    throw new CollectionImportError(
      urls.length
        ? "Import one cURL URL at a time."
        : "The cURL command has no URL.",
    );
  }
  let url = urls[0]!;
  if (!/^https?:\/\//i.test(url)) {
    warnings.push(`cURL URL ${url} was expanded using the http scheme.`);
    url = `http://${url}`;
  }
  const resolvedMethod = normaliseMethod(
    method ??
      (head
        ? "HEAD"
        : useGet
          ? "GET"
          : uploadFile
            ? "PUT"
            : data.length || forms.length
              ? "POST"
              : "GET"),
    warnings,
  );
  if (!resolvedMethod)
    throw new CollectionImportError("The cURL method is unsupported.");

  let authProfileKey: string | null = null;
  if (user !== null) {
    const separator = user.indexOf(":");
    authProfileKey = "curl:auth:basic";
    authProfiles.push({
      sourceKey: authProfileKey,
      name: "cURL Basic auth",
      type: "basic",
      configuration: {
        username: separator < 0 ? user : user.slice(0, separator),
        password: separator < 0 ? "" : user.slice(separator + 1),
      },
    });
  } else {
    const authorizationIndex = headers.findIndex(
      ({ name }) => name.toLocaleLowerCase() === "authorization",
    );
    const authorization = headers[authorizationIndex];
    const bearer = authorization?.value.match(/^Bearer\s+(.+)$/i);
    const basic = authorization?.value.match(/^Basic\s+(.+)$/i);
    if (bearer) {
      authProfileKey = "curl:auth:bearer";
      authProfiles.push({
        sourceKey: authProfileKey,
        name: "cURL Bearer auth",
        type: "bearer",
        configuration: { token: bearer[1]!, tokenPrefix: "Bearer" },
      });
      headers.splice(authorizationIndex, 1);
    } else if (basic) {
      let credentials = ":";
      try {
        credentials = Buffer.from(basic[1]!, "base64").toString("utf8");
      } catch {
        warnings.push(
          "The cURL Basic Authorization header could not be decoded.",
        );
      }
      const separator = credentials.indexOf(":");
      authProfileKey = "curl:auth:basic";
      authProfiles.push({
        sourceKey: authProfileKey,
        name: "cURL Basic auth",
        type: "basic",
        configuration: {
          username: credentials.slice(0, separator),
          password: credentials.slice(separator + 1),
        },
      });
      headers.splice(authorizationIndex, 1);
    }
  }

  if (json) {
    if (
      !headers.some(({ name }) => name.toLocaleLowerCase() === "content-type")
    ) {
      headers.push({
        name: "Content-Type",
        value: "application/json",
        enabled: true,
        secret: false,
      });
    }
    if (!headers.some(({ name }) => name.toLocaleLowerCase() === "accept")) {
      headers.push({
        name: "Accept",
        value: "application/json",
        enabled: true,
        secret: false,
      });
    }
  }
  const contentType =
    headers.find(({ name }) => name.toLocaleLowerCase() === "content-type")
      ?.value ?? null;
  let body = emptyBody();
  const queryParameters = [];
  try {
    const parsed = new URL(url);
    parsed.searchParams.forEach((value, name) => {
      queryParameters.push({
        name,
        value,
        enabled: true,
        secret: /secret|token|password|api[-_]?key/i.test(name),
      });
    });
    if ([...parsed.searchParams].length) {
      parsed.search = "";
      url = parsed.toString();
    }
  } catch {
    warnings.push("The cURL URL could not be decomposed into query fields.");
  }
  if (useGet && data.length) {
    for (const item of data.join("&").split("&")) {
      const separator = item.indexOf("=");
      queryParameters.push({
        name: separator < 0 ? item : item.slice(0, separator),
        value: separator < 0 ? "" : item.slice(separator + 1),
        enabled: true,
        secret: /secret|token|password|api[-_]?key/i.test(
          item.slice(0, Math.max(separator, 0)),
        ),
      });
    }
  } else if (forms.length) {
    body = {
      type: "multipart",
      content: JSON.stringify(forms, null, 2),
      contentType: "multipart/form-data",
      metadata: {},
    };
  } else if (data.length) {
    body = bodyFromText(data.join("&"), contentType);
  } else if (uploadFile) {
    body = {
      type: "binary",
      content: null,
      contentType: contentType ?? "application/octet-stream",
      metadata: { sourceFileName: uploadFile },
    };
  }

  const request = {
    sourceKey: "curl:request:1",
    name: requestName(resolvedMethod, url),
    description: "Imported from a cURL command.",
    folderPath: [],
    method: resolvedMethod,
    url,
    queryParameters,
    headers,
    requestVariables: [],
    body,
    settings: defaultSettings({
      followRedirects,
      tlsVerify,
      timeoutMs,
      cookies,
    }),
    authProfileKey,
    sourceMetadata: { command: "curl", optionCount: tokens.length },
  };

  return finalisePlan(
    {
      format: "curl",
      formatVersion: null,
      name: request.name,
      requests: [request],
      environments: [],
      projectVariables: [],
      authProfiles,
      unsupported,
      warnings,
    },
    input,
  );
}
