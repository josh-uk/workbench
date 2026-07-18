import type {
  PortableImportAuthProfile,
  PortableImportEnvironment,
  PortableImportPlan,
  PortableImportRequest,
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
  optionalText,
  parseBoundedJson,
  portableVariable,
  stringValue,
} from "./utils";

interface HttpieContext {
  warnings: string[];
  unsupported: string[];
  authProfiles: PortableImportAuthProfile[];
}

function listFields(value: unknown) {
  return arrayValue(value).flatMap((raw) => {
    const item = objectValue(raw);
    const name = stringValue(item.name)?.trim();
    if (!name) return [];
    return [
      {
        name,
        value: stringValue(item.value) ?? "",
        enabled: item.enabled !== false,
        secret: /authorization|api[-_]?key|secret|token|password/i.test(name),
      },
    ];
  });
}

function mapAuth(
  raw: unknown,
  sourceKey: string,
  fallbackName: string,
  context: HttpieContext,
) {
  const auth = objectValue(raw);
  const type = stringValue(auth.type);
  if (!type || type === "none" || type === "inherited") return null;
  const credentials = objectValue(auth.credentials);
  const username = stringValue(credentials.username) ?? "";
  const password = stringValue(credentials.password) ?? "";
  let profile: PortableImportAuthProfile | null = null;
  if (type === "basic") {
    profile = {
      sourceKey,
      name: `${fallbackName} Basic auth`.slice(0, 120),
      type: "basic",
      configuration: { username, password },
    };
  } else if (type === "bearer") {
    profile = {
      sourceKey,
      name: `${fallbackName} Bearer auth`.slice(0, 120),
      type: "bearer",
      configuration: { token: password || username, tokenPrefix: "Bearer" },
    };
  } else if (type === "apiKey") {
    const query = auth.target === "params";
    profile = {
      sourceKey,
      name: `${fallbackName} API key`.slice(0, 120),
      type: query ? "api_key_query" : "api_key_header",
      configuration: query
        ? { queryName: username || "api_key", key: password }
        : { headerName: username || "X-API-Key", key: password },
    };
  } else {
    context.unsupported.push(
      `HTTPie authentication type ${type} is unsupported.`,
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

function mapBody(raw: unknown, context: HttpieContext) {
  const body = objectValue(raw);
  const type = stringValue(body.type) ?? "none";
  if (type === "none") return emptyBody();
  if (type === "text") {
    const text = objectValue(body.text);
    return bodyFromText(
      stringValue(text.value) ?? "",
      stringValue(text.format) ?? "text/plain",
    );
  }
  if (type === "graphql") {
    const graphql = objectValue(body.graphql);
    let variables: unknown = {};
    const rawVariables = stringValue(graphql.variables) ?? "";
    if (rawVariables.trim()) {
      try {
        variables = JSON.parse(rawVariables) as unknown;
      } catch {
        context.warnings.push(
          "Invalid HTTPie GraphQL variables were preserved as text.",
        );
        variables = rawVariables;
      }
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
  if (type === "form") {
    const form = objectValue(body.form);
    const multipart = form.isMultipart === true;
    const fields = arrayValue(form.fields).flatMap((rawField) => {
      const field = objectValue(rawField);
      if (field.enabled === false) return [];
      const name = stringValue(field.name)?.trim();
      if (!name) return [];
      if (field.type === "file" || field.type === "filetext") {
        const fileName = stringValue(objectValue(field.file).name) ?? "file";
        context.unsupported.push(
          `HTTPie file ${fileName} for form field ${name} requires reselection after import.`,
        );
        return [{ name, value: `[file:${fileName}]` }];
      }
      return [{ name, value: stringValue(field.value) ?? "" }];
    });
    if (multipart) {
      return {
        type: "multipart" as const,
        content: JSON.stringify(fields, null, 2),
        contentType: "multipart/form-data",
        metadata: {},
      };
    }
    return {
      type: "form_urlencoded" as const,
      content: fields.map(({ name, value }) => `${name}=${value}`).join("\n"),
      contentType: "application/x-www-form-urlencoded",
      metadata: {},
    };
  }
  if (type === "file") {
    const fileName = stringValue(objectValue(body.file).name) ?? "file";
    context.unsupported.push(
      `HTTPie file body ${fileName} requires reselection after import.`,
    );
    return {
      type: "binary" as const,
      content: null,
      contentType: "application/octet-stream",
      metadata: { sourceFileName: fileName },
    };
  }
  context.unsupported.push(`HTTPie body type ${type} is unsupported.`);
  return emptyBody();
}

function requestFromHttpie(
  raw: unknown,
  folderPath: string[],
  inheritedAuthKey: string | null,
  index: number,
  context: HttpieContext,
): PortableImportRequest | null {
  const request = objectValue(raw);
  const method = normaliseMethod(request.method, context.warnings);
  const url = stringValue(request.url)?.trim();
  if (!method || !url) {
    context.warnings.push(
      `HTTPie request ${index + 1} was skipped because its URL is missing.`,
    );
    return null;
  }
  const name = normaliseName(request.name, `${method} ${url}`);
  const sourceKey = `httpie:${stringValue(request.id) ?? `${folderPath.join("/")}:${index}`}`;
  const ownAuth = objectValue(request.auth);
  const authProfileKey =
    ownAuth.type === "inherited"
      ? inheritedAuthKey
      : mapAuth(ownAuth, `${sourceKey}:auth`, name, context);
  const requestVariables = listFields(request.pathParams).flatMap((field) => {
    const variable = portableVariable(
      field.name,
      field.value,
      field.secret,
      field.enabled,
    );
    return variable ? [variable] : [];
  });
  let mappedUrl = url;
  for (const variable of requestVariables) {
    mappedUrl = mappedUrl
      .replaceAll(`{${variable.name}}`, `{{${variable.name}}}`)
      .replaceAll(`:${variable.name}`, `{{${variable.name}}}`);
  }
  return {
    sourceKey,
    name,
    description: "",
    folderPath,
    method,
    url: mappedUrl,
    queryParameters: listFields(request.queryParams),
    headers: listFields(request.headers),
    requestVariables,
    body: mapBody(request.body, context),
    settings: defaultSettings(),
    authProfileKey,
    sourceMetadata: {
      httpieId: stringValue(request.id),
      originalAuthType: stringValue(ownAuth.type),
    },
  };
}

function environmentFromHttpie(raw: unknown, index: number) {
  const environment = objectValue(raw);
  const variables = arrayValue(environment.variables).flatMap((rawVariable) => {
    const item = objectValue(rawVariable);
    const variable = portableVariable(
      item.name,
      item.value,
      item.isSecret === true,
      true,
    );
    return variable ? [variable] : [];
  });
  return {
    sourceKey: `httpie-environment:${stringValue(environment.id) ?? index}`,
    name: normaliseName(
      environment.name,
      environment.isDefault === true ? "Default" : `Environment ${index + 1}`,
    ),
    variables,
    sourceMetadata: {
      httpieId: stringValue(environment.id),
      isDefault: environment.isDefault === true,
      isLocalOnly: environment.isLocalOnly === true,
    },
  };
}

function collectionRequests(
  raw: unknown,
  context: HttpieContext,
): PortableImportRequest[] {
  const collection = objectValue(raw);
  const folder = normaliseName(collection.name, "HTTPie collection");
  const collectionKey = `httpie-collection:${stringValue(collection.id) ?? folder}`;
  const inheritedAuth = mapAuth(
    collection.auth,
    `${collectionKey}:auth`,
    folder,
    context,
  );
  return arrayValue(collection.requests).flatMap((request, index) => {
    const mapped = requestFromHttpie(
      request,
      [folder],
      inheritedAuth,
      index,
      context,
    );
    return mapped ? [mapped] : [];
  });
}

export function looksLikeHttpie(value: unknown) {
  const root = objectValue(value);
  const meta = objectValue(root.meta);
  return meta.format === "httpie";
}

export function parseHttpieExport(input: string): PortableImportPlan {
  const value = parseBoundedJson(input);
  const root = objectValue(value);
  const meta = objectValue(root.meta);
  if (meta.format !== "httpie") {
    throw new Error("Not an HTTPie export.");
  }
  const entry = objectValue(root.entry);
  const context: HttpieContext = {
    warnings: [],
    unsupported: [],
    authProfiles: [],
  };
  const formatVersion = optionalText(meta.version);
  if (formatVersion && !formatVersion.startsWith("1.")) {
    context.warnings.push(
      `HTTPie export version ${formatVersion} is newer than the tested 1.x schema.`,
    );
  }
  const contentType = stringValue(meta.contentType);
  const requests: PortableImportRequest[] = [];
  const environments: PortableImportEnvironment[] = [];
  let name = normaliseName(entry.name, "HTTPie import");

  if (contentType === "workspace" || Array.isArray(entry.collections)) {
    for (const collection of arrayValue(entry.collections)) {
      requests.push(...collectionRequests(collection, context));
    }
    for (const [index, draft] of arrayValue(entry.drafts).entries()) {
      const mapped = requestFromHttpie(draft, ["Drafts"], null, index, context);
      if (mapped) requests.push(mapped);
    }
    arrayValue(entry.environments).forEach((environment, index) =>
      environments.push(environmentFromHttpie(environment, index)),
    );
  } else if (contentType === "collection" || Array.isArray(entry.requests)) {
    requests.push(...collectionRequests(entry, context));
  } else if (contentType === "request" || "url" in entry) {
    const mapped = requestFromHttpie(entry, [], null, 0, context);
    if (mapped) requests.push(mapped);
    name = mapped?.name ?? name;
  } else if (contentType === "environment" || Array.isArray(entry.variables)) {
    environments.push(environmentFromHttpie(entry, 0));
  }

  return finalisePlan(
    {
      format: "httpie",
      formatVersion,
      name,
      requests,
      environments,
      projectVariables: [],
      authProfiles: context.authProfiles,
      unsupported: context.unsupported,
      warnings: context.warnings,
    },
    value,
  );
}
