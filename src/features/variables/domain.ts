import { z } from "zod";

import { maskSecret } from "@/core/secrets/redaction";
import {
  entityDescriptionSchema,
  entityIdSchema,
  entityNameSchema,
} from "@/features/workspaces/domain";

export const persistedVariableScopes = [
  "workspace",
  "workspace_environment",
  "project",
  "project_environment",
  "request",
] as const;

export const variableOrigins = [
  ...persistedVariableScopes,
  "generated",
  "runtime",
] as const;

export const variableNameSchema = z
  .string()
  .trim()
  .min(1, "Variable name is required.")
  .max(128, "Variable name must be 128 characters or fewer.")
  .regex(
    /^[A-Za-z_][A-Za-z0-9_.-]*$/,
    "Variable names must start with a letter or underscore and contain only letters, numbers, dots, dashes, or underscores.",
  );

export const variableValueSchema = z.object({
  name: variableNameSchema,
  value: z
    .string()
    .max(1_048_576, "Variable value must be 1 MiB or smaller.")
    .default(""),
  secret: z.boolean().default(false),
  enabled: z.boolean().default(true),
});

function validateDistinctNames(
  values: Array<{ name: string }>,
  context: z.RefinementCtx,
  label: string,
) {
  const names = new Set<string>();
  for (const [index, variable] of values.entries()) {
    const key = variable.name.toLocaleLowerCase();
    if (names.has(key)) {
      context.addIssue({
        code: "custom",
        message: `${label} ${variable.name} is duplicated.`,
        path: [index, "name"],
      });
    }
    names.add(key);
  }
}

export const variableValuesSchema = z
  .array(variableValueSchema)
  .max(500)
  .superRefine((values, context) =>
    validateDistinctNames(values, context, "Variable"),
  );

export const runtimeVariableSchema = variableValueSchema.extend({
  secret: z.boolean().default(true),
});

export const runtimeVariablesSchema = z
  .array(runtimeVariableSchema)
  .max(100, "At most 100 runtime overrides may be supplied.")
  .superRefine((values, context) => {
    validateDistinctNames(values, context, "Runtime variable");
  })
  .default([]);

export const createEnvironmentSchema = z.object({
  workspaceId: entityIdSchema,
  projectId: entityIdSchema.nullable().default(null),
  name: entityNameSchema,
  description: entityDescriptionSchema.default(""),
});

export const updateEnvironmentSchema = createEnvironmentSchema
  .omit({ workspaceId: true, projectId: true })
  .extend({ id: entityIdSchema });

export const environmentIdSchema = z.object({ environmentId: entityIdSchema });

export const saveVariableScopeSchema = z.object({
  scope: z.enum(persistedVariableScopes),
  workspaceId: entityIdSchema.nullable().default(null),
  projectId: entityIdSchema.nullable().default(null),
  environmentId: entityIdSchema.nullable().default(null),
  requestId: entityIdSchema.nullable().default(null),
  variables: variableValuesSchema,
});

export const variableConfigurationQuerySchema = z.object({
  workspaceId: entityIdSchema,
  projectId: entityIdSchema.nullable().default(null),
});

export interface VariableValue {
  name: string;
  value: string;
  secret: boolean;
  enabled: boolean;
}

export interface PersistedVariable extends VariableValue {
  id: string;
  scope: (typeof persistedVariableScopes)[number];
  workspaceId: string | null;
  projectId: string | null;
  environmentId: string | null;
  requestId: string | null;
}

export interface EnvironmentDetail {
  id: string;
  workspaceId: string;
  projectId: string | null;
  name: string;
  description: string | null;
  variables: PersistedVariable[];
}

export interface VariableConfiguration {
  workspaceVariables: PersistedVariable[];
  workspaceEnvironments: EnvironmentDetail[];
  projectVariables: PersistedVariable[];
  projectEnvironments: EnvironmentDetail[];
}

export interface VariableDefinition extends VariableValue {
  origin: (typeof variableOrigins)[number];
  originLabel: string;
}

export interface VariableResolutionError {
  code: "VARIABLE_CYCLE" | "VARIABLE_DEPTH";
  message: string;
  path: string[];
}

export interface InterpolationResult {
  value: string;
  preview: string;
  secret: boolean;
  unresolved: string[];
  errors: VariableResolutionError[];
  origins: string[];
}

export interface ResolvedVariable {
  name: string;
  value: string;
  preview: string;
  secret: boolean;
  origin: VariableDefinition["origin"];
  originLabel: string;
  unresolved: string[];
  errors: VariableResolutionError[];
}

const interpolationPattern = /{{\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*}}/g;
const MAX_RESOLUTION_DEPTH = 20;

function unique<T>(values: readonly T[]) {
  return [...new Set(values)];
}

function uniqueErrors(errors: readonly VariableResolutionError[]) {
  const seen = new Set<string>();
  return errors.filter((error) => {
    const key = `${error.code}:${error.path.join("->")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function createVariableResolver(definitions: VariableDefinition[]) {
  const selected = new Map<string, VariableDefinition>();
  for (const definition of definitions) {
    if (definition.enabled) selected.set(definition.name, definition);
  }

  const cache = new Map<string, InterpolationResult>();

  const interpolateInternal = (
    template: string,
    stack: string[],
  ): InterpolationResult => {
    let secret = false;
    const unresolved: string[] = [];
    const errors: VariableResolutionError[] = [];
    const origins: string[] = [];
    const value = template.replace(
      interpolationPattern,
      (placeholder: string, name: string) => {
        const resolved = resolveName(name, stack);
        secret ||= resolved.secret;
        unresolved.push(...resolved.unresolved);
        errors.push(...resolved.errors);
        origins.push(...resolved.origins);
        return resolved.unresolved.includes(name)
          ? placeholder
          : resolved.value;
      },
    );
    const preview = template.replace(
      interpolationPattern,
      (placeholder: string, name: string) => {
        const resolved = resolveName(name, stack);
        if (resolved.unresolved.includes(name)) return placeholder;
        return resolved.secret ? maskSecret(resolved.value) : resolved.value;
      },
    );
    return {
      value,
      preview,
      secret,
      unresolved: unique(unresolved),
      errors: uniqueErrors(errors),
      origins: unique(origins),
    };
  };

  const resolveName = (
    name: string,
    stack: string[] = [],
  ): InterpolationResult => {
    const cached = cache.get(name);
    if (cached && stack.length === 0) return cached;

    const definition = selected.get(name);
    if (!definition) {
      return {
        value: `{{${name}}}`,
        preview: `{{${name}}}`,
        secret: false,
        unresolved: [name],
        errors: [],
        origins: [],
      };
    }

    const cycleIndex = stack.indexOf(name);
    if (cycleIndex !== -1) {
      const path = [...stack.slice(cycleIndex), name];
      return {
        value: `{{${name}}}`,
        preview: `{{${name}}}`,
        secret: definition.secret,
        unresolved: [],
        errors: [
          {
            code: "VARIABLE_CYCLE",
            message: `Variable cycle detected: ${path.join(" → ")}.`,
            path,
          },
        ],
        origins: [definition.originLabel],
      };
    }

    if (stack.length >= MAX_RESOLUTION_DEPTH) {
      const path = [...stack, name];
      return {
        value: `{{${name}}}`,
        preview: `{{${name}}}`,
        secret: definition.secret,
        unresolved: [],
        errors: [
          {
            code: "VARIABLE_DEPTH",
            message: `Variable resolution exceeded ${MAX_RESOLUTION_DEPTH} levels.`,
            path,
          },
        ],
        origins: [definition.originLabel],
      };
    }

    const nested = interpolateInternal(definition.value, [...stack, name]);
    const result = {
      ...nested,
      preview:
        definition.secret || nested.secret
          ? maskSecret(nested.value)
          : nested.preview,
      secret: definition.secret || nested.secret,
      origins: unique([definition.originLabel, ...nested.origins]),
    };
    if (stack.length === 0) cache.set(name, result);
    return result;
  };

  return {
    interpolate(template: string) {
      return interpolateInternal(template, []);
    },
    resolveVariables(): ResolvedVariable[] {
      return [...selected.entries()]
        .map(([name, definition]) => {
          const resolved = resolveName(name);
          return {
            name,
            value: resolved.value,
            preview: resolved.secret
              ? maskSecret(resolved.value)
              : resolved.preview,
            secret: resolved.secret,
            origin: definition.origin,
            originLabel: definition.originLabel,
            unresolved: resolved.unresolved,
            errors: resolved.errors,
          };
        })
        .sort((left, right) => left.name.localeCompare(right.name));
    },
  };
}

export class VariableDomainError extends Error {
  constructor(
    message: string,
    public readonly code = "VARIABLE_INVALID",
  ) {
    super(message);
    this.name = "VariableDomainError";
  }
}
