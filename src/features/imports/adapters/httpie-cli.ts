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
import { parseShellWords } from "./shell-words";

function optionValue(token: string, longName: string, shortName?: string) {
  if (token.startsWith(`${longName}=`)) return token.slice(longName.length + 1);
  if (shortName && token.startsWith(shortName) && token !== shortName) {
    return token.slice(shortName.length);
  }
  return null;
}

function secretName(name: string) {
  return /authorization|api[-_]?key|secret|token|password/i.test(name);
}

function requestName(method: string, url: string) {
  try {
    const parsed = new URL(url);
    return `${method} ${parsed.pathname === "/" ? parsed.hostname : parsed.pathname}`.slice(
      0,
      120,
    );
  } catch {
    return `${method} ${url}`.slice(0, 120);
  }
}

function normaliseHttpieUrl(
  value: string,
  command: string,
  warnings: string[],
) {
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith(":")) {
    return `${command}://localhost${value}`;
  }
  warnings.push(
    `HTTPie URL ${value} was expanded using the ${command} scheme.`,
  );
  return `${command}://${value}`;
}

export function looksLikeHttpieCommand(input: string) {
  return /^\s*(?:\$\s*)?(?:http|https)(?:\s|$)/i.test(input);
}

export function parseHttpieCommand(input: string): PortableImportPlan {
  const tokens = parseShellWords(input);
  if (tokens[0] === "$") tokens.shift();
  const command = tokens.shift()?.toLocaleLowerCase();
  if (command !== "http" && command !== "https") {
    throw new CollectionImportError(
      "The command must start with http or https.",
    );
  }

  const warnings: string[] = [];
  const unsupported: string[] = [];
  const headers: PortableImportRequest["headers"] = [];
  const queryParameters: PortableImportRequest["queryParameters"] = [];
  const fields = new Map<string, unknown>();
  const formFields: Array<{ name: string; value: string }> = [];
  const cookies: PortableImportRequest["settings"]["cookies"] = [];
  const authProfiles: PortableImportAuthProfile[] = [];
  let method: string | null = null;
  let rawUrl: string | null = null;
  let auth: string | null = null;
  let authType = "basic";
  let form = false;
  let multipart = false;
  let followRedirects = false;
  let tlsVerify = true;
  let timeoutMs: number | undefined;
  let rawBody: string | null = null;

  const takeNext = (index: number, option: string) => {
    const value = tokens[index + 1];
    if (value === undefined) {
      throw new CollectionImportError(
        `HTTPie option ${option} requires a value.`,
      );
    }
    return value;
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const authOption = optionValue(token, "--auth", "-a");
    if (authOption !== null || token === "--auth" || token === "-a") {
      auth = authOption ?? takeNext(index, token);
      if (authOption === null) index += 1;
      continue;
    }
    const authTypeOption = optionValue(token, "--auth-type", "-A");
    if (authTypeOption !== null || token === "--auth-type" || token === "-A") {
      authType = authTypeOption ?? takeNext(index, token);
      if (authTypeOption === null) index += 1;
      continue;
    }
    const timeoutOption = optionValue(token, "--timeout");
    if (timeoutOption !== null || token === "--timeout") {
      const seconds = Number(timeoutOption ?? takeNext(index, token));
      if (timeoutOption === null) index += 1;
      if (Number.isFinite(seconds) && seconds > 0) {
        timeoutMs = Math.min(Math.round(seconds * 1_000), 120_000);
      } else {
        warnings.push(`HTTPie timeout value ${String(seconds)} was ignored.`);
      }
      continue;
    }
    const verifyOption = optionValue(token, "--verify");
    if (verifyOption !== null || token === "--verify") {
      const value = verifyOption ?? takeNext(index, token);
      if (verifyOption === null) index += 1;
      tlsVerify = !["no", "false", "0"].includes(value.toLocaleLowerCase());
      continue;
    }
    const rawOption = optionValue(token, "--raw");
    if (rawOption !== null || token === "--raw") {
      rawBody = rawOption ?? takeNext(index, token);
      if (rawOption === null) index += 1;
      continue;
    }
    if (token === "--form" || token === "-f") {
      form = true;
      continue;
    }
    if (token === "--multipart") {
      form = true;
      multipart = true;
      continue;
    }
    if (token === "--follow" || token === "-F") {
      followRedirects = true;
      continue;
    }
    if (token === "--ignore-stdin" || token === "--offline") continue;
    if (token.startsWith("-")) {
      warnings.push(`HTTPie option ${token} was ignored.`);
      continue;
    }
    if (!method && /^[A-Za-z]+$/.test(token) && !rawUrl) {
      const candidate = normaliseMethod(token, []);
      if (candidate) {
        method = candidate;
        continue;
      }
    }
    if (!rawUrl) {
      rawUrl = token;
      continue;
    }

    const querySeparator = token.indexOf("==");
    const rawJsonSeparator = token.indexOf(":=");
    const headerSeparator = token.indexOf(":");
    const fieldSeparator = token.indexOf("=");
    if (querySeparator > 0) {
      const name = token.slice(0, querySeparator);
      queryParameters.push({
        name,
        value: token.slice(querySeparator + 2),
        enabled: true,
        secret: secretName(name),
      });
    } else if (rawJsonSeparator > 0) {
      const name = token.slice(0, rawJsonSeparator);
      const value = token.slice(rawJsonSeparator + 2);
      try {
        fields.set(name, JSON.parse(value) as unknown);
      } catch {
        throw new CollectionImportError(`HTTPie JSON item ${name} is invalid.`);
      }
    } else if (headerSeparator > 0) {
      const name = token.slice(0, headerSeparator);
      let value = token.slice(headerSeparator + 1);
      if (value.startsWith("@")) {
        unsupported.push(
          `HTTPie header file ${value.slice(1)} was not read; paste its value after import.`,
        );
        value = "";
      }
      headers.push({
        name,
        value,
        enabled: value !== "",
        secret: secretName(name),
      });
    } else if (fieldSeparator > 0) {
      const name = token.slice(0, fieldSeparator);
      let value = token.slice(fieldSeparator + 1);
      if (value.startsWith("@")) {
        multipart = true;
        unsupported.push(
          `HTTPie file ${value.slice(1)} requires reselection after import.`,
        );
        value = `[file:${value.slice(1)}]`;
      }
      if (form || multipart) formFields.push({ name, value });
      else fields.set(name, value);
    } else if (token.includes("@")) {
      const separator = token.indexOf("@");
      const name = token.slice(0, separator);
      if (name) {
        multipart = true;
        const fileName = token.slice(separator + 1);
        formFields.push({ name, value: `[file:${fileName}]` });
        unsupported.push(
          `HTTPie file ${fileName} requires reselection after import.`,
        );
      }
    } else {
      warnings.push(`HTTPie request item ${token} was ignored.`);
    }
  }

  if (!rawUrl)
    throw new CollectionImportError("The HTTPie command has no URL.");
  const urlWithScheme = normaliseHttpieUrl(rawUrl, command, warnings);
  let url = urlWithScheme;
  try {
    const parsed = new URL(urlWithScheme);
    parsed.searchParams.forEach((value, name) => {
      if (
        !queryParameters.some(
          (field) => field.name === name && field.value === value,
        )
      ) {
        queryParameters.push({
          name,
          value,
          enabled: true,
          secret: secretName(name),
        });
      }
    });
    if ([...parsed.searchParams].length) {
      parsed.search = "";
      url = parsed.toString();
    }
  } catch {
    warnings.push("The HTTPie URL could not be decomposed into query fields.");
  }

  let authProfileKey: string | null = null;
  if (auth !== null) {
    authProfileKey = "httpie-cli:auth:1";
    if (authType.toLocaleLowerCase() === "bearer") {
      authProfiles.push({
        sourceKey: authProfileKey,
        name: "HTTPie Bearer auth",
        type: "bearer",
        configuration: { token: auth, tokenPrefix: "Bearer" },
      });
    } else if (authType.toLocaleLowerCase() === "basic") {
      const separator = auth.indexOf(":");
      authProfiles.push({
        sourceKey: authProfileKey,
        name: "HTTPie Basic auth",
        type: "basic",
        configuration: {
          username: separator < 0 ? auth : auth.slice(0, separator),
          password: separator < 0 ? "" : auth.slice(separator + 1),
        },
      });
    } else {
      unsupported.push(
        `HTTPie authentication type ${authType} is unsupported.`,
      );
      authProfileKey = null;
    }
  }

  const contentType =
    headers.find(({ name }) => name.toLocaleLowerCase() === "content-type")
      ?.value ?? null;
  let body: PortableImportRequest["body"] = emptyBody();
  if (rawBody !== null) {
    body = bodyFromText(rawBody, contentType);
  } else if (multipart || (form && formFields.length)) {
    body = {
      type: multipart ? "multipart" : "form_urlencoded",
      content: multipart
        ? JSON.stringify(formFields, null, 2)
        : formFields.map(({ name, value }) => `${name}=${value}`).join("\n"),
      contentType: multipart
        ? "multipart/form-data"
        : "application/x-www-form-urlencoded",
      metadata: {},
    };
  } else if (fields.size) {
    body = {
      type: "json",
      content: JSON.stringify(Object.fromEntries(fields), null, 2),
      contentType: contentType ?? "application/json",
      metadata: {},
    };
  }
  const resolvedMethod = normaliseMethod(
    method ?? (body.type === "none" ? "GET" : "POST"),
    warnings,
  );
  if (!resolvedMethod)
    throw new CollectionImportError("The HTTPie method is unsupported.");
  const request: PortableImportRequest = {
    sourceKey: "httpie-cli:request:1",
    name: requestName(resolvedMethod, url),
    description: "Imported from an HTTPie CLI command.",
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
    sourceMetadata: { command },
  };
  return finalisePlan(
    {
      format: "httpie",
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
