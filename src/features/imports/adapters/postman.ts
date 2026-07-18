import type {
  PortableImportAuthProfile,
  PortableImportEnvironment,
  PortableImportPlan,
  PortableImportRequest,
  PortableImportVariable,
} from "../domain";
import {
  arrayValue,
  bodyFromText,
  defaultSettings,
  emptyBody,
  finalisePlan,
  normaliseMethod,
  normaliseName,
  objectValue,
  parseBoundedJson,
  portableVariable,
  stringValue,
} from "./utils";

interface PostmanContext {
  warnings: string[];
  unsupported: string[];
  authProfiles: PortableImportAuthProfile[];
}

function valuesByKey(value: unknown) {
  return new Map(
    arrayValue(value).flatMap((raw) => {
      const item = objectValue(raw);
      const key = stringValue(item.key);
      return key ? [[key, stringValue(item.value) ?? ""] as const] : [];
    }),
  );
}

function mapAuth(
  raw: unknown,
  sourceKey: string,
  fallbackName: string,
  context: PostmanContext,
) {
  const auth = objectValue(raw);
  const type = stringValue(auth.type);
  if (!type || type === "noauth" || type === "inherit") return null;
  const fields = valuesByKey(auth[type]);
  let profile: PortableImportAuthProfile | null = null;
  if (type === "basic") {
    profile = {
      sourceKey,
      name: `${fallbackName} Basic auth`.slice(0, 120),
      type: "basic",
      configuration: {
        username: fields.get("username") ?? "",
        password: fields.get("password") ?? "",
      },
    };
  } else if (type === "bearer") {
    profile = {
      sourceKey,
      name: `${fallbackName} Bearer auth`.slice(0, 120),
      type: "bearer",
      configuration: {
        token: fields.get("token") ?? "",
        tokenPrefix: "Bearer",
      },
    };
  } else if (type === "apikey") {
    const query = fields.get("in") === "query";
    profile = {
      sourceKey,
      name: `${fallbackName} API key`.slice(0, 120),
      type: query ? "api_key_query" : "api_key_header",
      configuration: query
        ? {
            queryName: fields.get("key") ?? "api_key",
            key: fields.get("value") ?? "",
          }
        : {
            headerName: fields.get("key") ?? "X-API-Key",
            key: fields.get("value") ?? "",
          },
    };
  } else {
    context.unsupported.push(
      `Postman authentication type ${type} is unsupported.`,
    );
  }
  if (
    profile &&
    !context.authProfiles.some(({ sourceKey: key }) => key === sourceKey)
  ) {
    context.authProfiles.push(profile);
  }
  return profile?.sourceKey ?? null;
}

function mapBody(
  raw: unknown,
  headers: PortableImportRequest["headers"],
  context: PostmanContext,
) {
  const body = objectValue(raw);
  const mode = stringValue(body.mode);
  if (!mode) return emptyBody();
  const contentType =
    headers.find(({ name }) => name.toLocaleLowerCase() === "content-type")
      ?.value ?? null;
  if (mode === "raw") {
    return bodyFromText(stringValue(body.raw) ?? "", contentType);
  }
  if (mode === "urlencoded") {
    const fields = arrayValue(body.urlencoded).flatMap((rawField) => {
      const field = objectValue(rawField);
      const key = stringValue(field.key);
      return key && field.disabled !== true
        ? [{ name: key, value: stringValue(field.value) ?? "" }]
        : [];
    });
    return {
      type: "form_urlencoded" as const,
      content: fields.map(({ name, value }) => `${name}=${value}`).join("\n"),
      contentType: "application/x-www-form-urlencoded",
      metadata: {},
    };
  }
  if (mode === "formdata") {
    const fields = arrayValue(body.formdata).flatMap((rawField) => {
      const field = objectValue(rawField);
      const key = stringValue(field.key);
      if (!key || field.disabled === true) return [];
      if (field.type === "file") {
        context.unsupported.push(
          `Postman file field ${key} requires file reselection after import.`,
        );
        return [{ name: key, value: "[file]" }];
      }
      return [{ name: key, value: stringValue(field.value) ?? "" }];
    });
    return {
      type: "multipart" as const,
      content: JSON.stringify(fields, null, 2),
      contentType: "multipart/form-data",
      metadata: {},
    };
  }
  if (mode === "graphql") {
    const graphql = objectValue(body.graphql);
    let variables: unknown = {};
    try {
      variables = JSON.parse(stringValue(graphql.variables) ?? "{}") as unknown;
    } catch {
      context.warnings.push(
        "Invalid Postman GraphQL variables were preserved as text.",
      );
      variables = stringValue(graphql.variables) ?? "";
    }
    return {
      type: "json" as const,
      content: JSON.stringify(
        { query: stringValue(graphql.query) ?? "", variables },
        null,
        2,
      ),
      contentType: "application/json",
      metadata: { sourceBodyType: "graphql" },
    };
  }
  if (mode === "file") {
    context.unsupported.push(
      "Postman file bodies require file reselection after import.",
    );
    return {
      type: "binary" as const,
      content: null,
      contentType: contentType ?? "application/octet-stream",
      metadata: {},
    };
  }
  context.unsupported.push(`Postman body mode ${mode} is unsupported.`);
  return emptyBody();
}

function requestDescription(value: unknown) {
  if (typeof value === "string") return value.slice(0, 4_000);
  return (stringValue(objectValue(value).content) ?? "").slice(0, 4_000);
}

function mapRequest(
  item: Record<string, unknown>,
  folderPath: string[],
  inheritedAuthKey: string | null,
  index: number,
  context: PostmanContext,
): PortableImportRequest | null {
  const request =
    typeof item.request === "string"
      ? { url: item.request }
      : objectValue(item.request);
  const method = normaliseMethod(request.method, context.warnings);
  const urlObject = objectValue(request.url);
  const rawUrl = (() => {
    if (typeof request.url === "string") return request.url;
    const raw = stringValue(urlObject.raw);
    if (raw) return raw;
    const protocol = stringValue(urlObject.protocol) ?? "https";
    const host = Array.isArray(urlObject.host)
      ? urlObject.host.map((part) => stringValue(part) ?? "").join(".")
      : (stringValue(urlObject.host) ?? "");
    const path = Array.isArray(urlObject.path)
      ? urlObject.path.map((part) => stringValue(part) ?? "").join("/")
      : (stringValue(urlObject.path) ?? "");
    return host ? `${protocol}://${host}${path ? `/${path}` : ""}` : null;
  })();
  if (!method || !rawUrl?.trim()) {
    context.warnings.push(
      `Postman item ${normaliseName(item.name, `${index + 1}`)} was skipped because its URL is missing.`,
    );
    return null;
  }
  const name = normaliseName(item.name, `${method} ${rawUrl}`);
  const sourceKey = `postman:${stringValue(item.id) ?? `${folderPath.join("/")}:${index}:${name}`}`;
  const headers = arrayValue(request.header).flatMap((rawHeader) => {
    const header = objectValue(rawHeader);
    const headerName = stringValue(header.key)?.trim();
    return headerName
      ? [
          {
            name: headerName,
            value: stringValue(header.value) ?? "",
            enabled: header.disabled !== true,
            secret: /authorization|api[-_]?key|secret|token|password/i.test(
              headerName,
            ),
          },
        ]
      : [];
  });
  const queryParameters = arrayValue(urlObject.query).flatMap((rawQuery) => {
    const query = objectValue(rawQuery);
    const key = stringValue(query.key)?.trim();
    return key
      ? [
          {
            name: key,
            value: stringValue(query.value) ?? "",
            enabled: query.disabled !== true,
            secret: /api[-_]?key|secret|token|password/i.test(key),
          },
        ]
      : [];
  });
  const requestVariables = arrayValue(urlObject.variable).flatMap(
    (rawVariable) => {
      const variable = objectValue(rawVariable);
      const mapped = portableVariable(
        variable.key,
        variable.value,
        false,
        true,
      );
      return mapped ? [mapped] : [];
    },
  );
  let url = queryParameters.length ? rawUrl.split("?", 1)[0]! : rawUrl;
  for (const variable of requestVariables) {
    url = url
      .replaceAll(`:${variable.name}`, `{{${variable.name}}}`)
      .replaceAll(`{${variable.name}}`, `{{${variable.name}}}`);
  }
  const ownAuth = objectValue(request.auth);
  const authProfileKey =
    !Object.keys(ownAuth).length || ownAuth.type === "inherit"
      ? inheritedAuthKey
      : mapAuth(ownAuth, `${sourceKey}:auth`, name, context);
  return {
    sourceKey,
    name,
    description: requestDescription(request.description),
    folderPath,
    method,
    url,
    queryParameters,
    headers,
    requestVariables,
    body: mapBody(request.body, headers, context),
    settings: defaultSettings(),
    authProfileKey,
    sourceMetadata: {
      postmanId: stringValue(item.id),
      originalName: stringValue(item.name),
    },
  };
}

function walkItems(
  items: unknown,
  folderPath: string[],
  inheritedAuthKey: string | null,
  context: PostmanContext,
  requests: PortableImportRequest[],
) {
  arrayValue(items).forEach((rawItem, index) => {
    const item = objectValue(rawItem);
    if (Array.isArray(item.item)) {
      const folderName = normaliseName(item.name, `Folder ${index + 1}`);
      const folderKey = `postman-folder:${folderPath.join("/")}:${folderName}:auth`;
      const folderAuth = Object.keys(objectValue(item.auth)).length
        ? mapAuth(item.auth, folderKey, folderName, context)
        : inheritedAuthKey;
      walkItems(
        item.item,
        [...folderPath, folderName],
        folderAuth,
        context,
        requests,
      );
      return;
    }
    const request = mapRequest(
      item,
      folderPath,
      inheritedAuthKey,
      index,
      context,
    );
    if (request) requests.push(request);
    if (arrayValue(item.event).length) {
      context.unsupported.push(
        `Postman scripts on ${normaliseName(item.name, "a request")} were not imported.`,
      );
    }
  });
}

export function looksLikePostman(value: unknown) {
  const root = objectValue(value);
  return (
    stringValue(objectValue(root.info).schema)?.includes("getpostman.com") ===
      true || stringValue(root._postman_variable_scope) === "environment"
  );
}

export function parsePostmanExport(input: string): PortableImportPlan {
  const value = parseBoundedJson(input);
  const root = objectValue(value);
  if (!looksLikePostman(root)) throw new Error("Not a Postman export.");
  const context: PostmanContext = {
    warnings: [],
    unsupported: [],
    authProfiles: [],
  };
  const environments: PortableImportEnvironment[] = [];
  const requests: PortableImportRequest[] = [];
  const projectVariables: PortableImportVariable[] = [];
  let name = "Postman import";
  let formatVersion: string | null = null;

  if (root._postman_variable_scope === "environment") {
    name = normaliseName(root.name, "Postman environment");
    environments.push({
      sourceKey: `postman-environment:${stringValue(root.id) ?? name}`,
      name,
      variables: arrayValue(root.values).flatMap((rawVariable) => {
        const variable = objectValue(rawVariable);
        const mapped = portableVariable(
          variable.key,
          variable.value,
          /secret|token|password|api[-_]?key/i.test(
            stringValue(variable.key) ?? "",
          ),
          variable.enabled !== false,
        );
        return mapped ? [mapped] : [];
      }),
      sourceMetadata: { postmanId: stringValue(root.id) },
    });
  } else {
    const info = objectValue(root.info);
    name = normaliseName(info.name, "Postman collection");
    const schema = stringValue(info.schema);
    formatVersion = schema?.match(/collection\/(v[\d.]+)/)?.[1] ?? null;
    const rootAuth = mapAuth(
      root.auth,
      "postman:collection:auth",
      name,
      context,
    );
    walkItems(root.item, [], rootAuth, context, requests);
    arrayValue(root.variable).forEach((rawVariable) => {
      const variable = objectValue(rawVariable);
      const mapped = portableVariable(
        variable.key,
        variable.value,
        /secret|token|password|api[-_]?key/i.test(
          stringValue(variable.key) ?? "",
        ),
        variable.disabled !== true,
      );
      if (mapped) projectVariables.push(mapped);
    });
  }

  return finalisePlan(
    {
      format: "postman",
      formatVersion,
      name,
      requests,
      environments,
      projectVariables,
      authProfiles: context.authProfiles,
      unsupported: context.unsupported,
      warnings: context.warnings,
    },
    value,
  );
}
