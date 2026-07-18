import type { RequestPlan } from "@/features/requests/execution/http-engine";
import {
  createVariableResolver,
  type InterpolationResult,
  type ResolvedVariable,
  type VariableDefinition,
  type VariableResolutionError,
} from "@/features/variables/domain";

export interface RequestResolutionPreview {
  method: string;
  url: string;
  queryParameters: Array<{
    name: string;
    value: string;
    enabled: boolean;
    secret: boolean;
  }>;
  headers: Array<{
    name: string;
    value: string;
    enabled: boolean;
    secret: boolean;
  }>;
  cookies: Array<{
    name: string;
    value: string;
    enabled: boolean;
    secret: boolean;
  }>;
  body: {
    type: RequestPlan["body"]["type"];
    content: string | null;
    contentType: string | null;
    secret: boolean;
  };
}

export interface RequestResolution {
  plan: RequestPlan;
  preview: RequestResolutionPreview;
  variables: ResolvedVariable[];
  unresolved: string[];
  errors: VariableResolutionError[];
}

function unique<T>(values: readonly T[]) {
  return [...new Set(values)];
}

function collectDiagnostics(results: readonly InterpolationResult[]) {
  const errors = new Map<string, VariableResolutionError>();
  for (const result of results) {
    for (const error of result.errors) {
      errors.set(`${error.code}:${error.path.join("->")}`, error);
    }
  }
  return {
    unresolved: unique(results.flatMap(({ unresolved }) => unresolved)).sort(),
    errors: [...errors.values()],
  };
}

export function resolveRequestPlan(
  source: RequestPlan,
  definitions: VariableDefinition[],
): RequestResolution {
  const resolver = createVariableResolver(definitions);
  const diagnostics: InterpolationResult[] = [];
  const interpolate = (value: string) => {
    const result = resolver.interpolate(value);
    diagnostics.push(result);
    return result;
  };

  const url = interpolate(source.url);
  const queryParameters = source.queryParameters.map((parameter) => {
    const name = interpolate(parameter.name);
    const value = interpolate(parameter.value);
    return {
      actual: {
        ...parameter,
        name: name.value,
        value: value.value,
        secret: parameter.secret || name.secret || value.secret,
      },
      preview: {
        ...parameter,
        name: name.preview,
        value: value.preview,
        secret: parameter.secret || name.secret || value.secret,
      },
    };
  });
  const headers = source.headers.map((header) => {
    const name = interpolate(header.name);
    const value = interpolate(header.value);
    return {
      actual: {
        ...header,
        name: name.value,
        value: value.value,
        secret: header.secret || name.secret || value.secret,
      },
      preview: {
        ...header,
        name: name.preview,
        value: value.preview,
        secret: header.secret || name.secret || value.secret,
      },
    };
  });
  const cookies = source.settings.cookies.map((cookie) => {
    const name = interpolate(cookie.name);
    const value = interpolate(cookie.value);
    return {
      actual: {
        ...cookie,
        name: name.value,
        value: value.value,
        secret: true,
      },
      preview: {
        ...cookie,
        name: name.preview,
        value: value.preview,
        secret: true,
      },
    };
  });
  const bodyContent = source.body.content
    ? interpolate(source.body.content)
    : null;
  const bodyContentType = source.body.contentType
    ? interpolate(source.body.contentType)
    : null;
  const variables = resolver.resolveVariables();
  const variableDiagnostics = variables.flatMap((variable) => [
    {
      value: variable.value,
      preview: variable.preview,
      secret: variable.secret,
      unresolved: variable.unresolved,
      errors: variable.errors,
      origins: [variable.originLabel],
    },
  ]);
  const resultDiagnostics = collectDiagnostics([
    ...diagnostics,
    ...variableDiagnostics,
  ]);
  const secretValues = unique(
    variables
      .filter(({ secret, value }) => secret && value.length > 0)
      .map(({ value }) => value),
  );

  return {
    plan: {
      ...source,
      url: url.value,
      queryParameters: queryParameters.map(({ actual }) => actual),
      headers: headers.map(({ actual }) => actual),
      body: {
        ...source.body,
        content: bodyContent?.value ?? null,
        contentType: bodyContentType?.value ?? null,
      },
      settings: {
        ...source.settings,
        cookies: cookies.map(({ actual }) => actual),
      },
      secretValues,
    },
    preview: {
      method: source.method,
      url: url.preview,
      queryParameters: queryParameters.map(({ preview }) => preview),
      headers: headers.map(({ preview }) => preview),
      cookies: cookies.map(({ preview }) => preview),
      body: {
        type: source.body.type,
        content: bodyContent?.preview ?? null,
        contentType: bodyContentType?.preview ?? null,
        secret: Boolean(bodyContent?.secret || bodyContentType?.secret),
      },
    },
    variables,
    ...resultDiagnostics,
  };
}
