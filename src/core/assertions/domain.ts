import { z } from "zod";

export const assertionTypes = [
  "status_equals",
  "status_range",
  "duration_below",
  "header_exists",
  "header_equals",
  "jsonpath_exists",
  "jsonpath_equals",
  "jsonpath_regex",
  "body_contains",
  "body_schema",
] as const;

export const assertionTypeSchema = z.enum(assertionTypes);
export type AssertionType = z.infer<typeof assertionTypeSchema>;

const assertionNameSchema = z
  .string()
  .trim()
  .min(1, "Assertion name is required.")
  .max(120);
const headerNameSchema = z.string().trim().min(1).max(256);
const jsonPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .refine((value) => value.startsWith("$"), "JSONPath must start with $.");

export function unsafeRegexReason(pattern: string) {
  if (pattern.length > 256)
    return "Regular expressions must be 256 characters or fewer.";
  if (/\\[1-9]/.test(pattern))
    return "Regular-expression backreferences are not supported.";
  if (/\(\?(?:[=!]|<[=!])/.test(pattern)) {
    return "Regular-expression lookarounds are not supported.";
  }
  if (/\([^)]*(?:\*|\+|\{\d+,?\d*\})[^)]*\)(?:\*|\+|\{)/.test(pattern)) {
    return "Nested regular-expression quantifiers are not supported.";
  }
  if (/\([^)]*\|[^)]*\)(?:\*|\+)/.test(pattern)) {
    return "Quantified regular-expression alternatives are not supported.";
  }
  let unboundedQuantifiers = 0;
  let escaped = false;
  let characterClass = false;
  for (const character of pattern) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "[") characterClass = true;
    else if (character === "]") characterClass = false;
    else if (!characterClass && (character === "*" || character === "+")) {
      unboundedQuantifiers += 1;
    }
  }
  if (unboundedQuantifiers > 1) {
    return "Multiple unbounded regular-expression quantifiers are not supported.";
  }
  try {
    new RegExp(pattern);
  } catch {
    return "The regular expression is invalid.";
  }
  return null;
}

const regularExpressionSchema = z
  .string()
  .min(1)
  .max(256)
  .superRefine((value, context) => {
    const reason = unsafeRegexReason(value);
    if (reason) context.addIssue({ code: "custom", message: reason });
  });
const regexFlagsSchema = z
  .string()
  .max(4)
  .regex(/^(?!.*(.).*\1)[imsu]*$/, "Use unique i, m, s, or u flags only.");

const base = {
  id: z.uuid().optional(),
  name: assertionNameSchema,
  enabled: z.boolean().default(true),
};

export const assertionDefinitionSchema = z.discriminatedUnion("type", [
  z.object({
    ...base,
    type: z.literal("status_equals"),
    configuration: z.object({ expected: z.number().int().min(100).max(599) }),
  }),
  z
    .object({
      ...base,
      type: z.literal("status_range"),
      configuration: z.object({
        minimum: z.number().int().min(100).max(599),
        maximum: z.number().int().min(100).max(599),
      }),
    })
    .refine(
      ({ configuration }) => configuration.minimum <= configuration.maximum,
      { message: "Minimum status must not exceed maximum status." },
    ),
  z.object({
    ...base,
    type: z.literal("duration_below"),
    configuration: z.object({
      maximumMs: z.number().int().min(1).max(120_000),
    }),
  }),
  z.object({
    ...base,
    type: z.literal("header_exists"),
    configuration: z.object({ name: headerNameSchema }),
  }),
  z.object({
    ...base,
    type: z.literal("header_equals"),
    configuration: z.object({
      name: headerNameSchema,
      expected: z.string().max(8_192),
      caseSensitive: z.boolean().default(true),
    }),
  }),
  z.object({
    ...base,
    type: z.literal("jsonpath_exists"),
    configuration: z.object({ path: jsonPathSchema }),
  }),
  z.object({
    ...base,
    type: z.literal("jsonpath_equals"),
    configuration: z.object({
      path: jsonPathSchema,
      expected: z.string().max(65_536),
      mode: z.enum(["text", "json"]).default("text"),
    }),
  }),
  z.object({
    ...base,
    type: z.literal("jsonpath_regex"),
    configuration: z.object({
      path: jsonPathSchema,
      pattern: regularExpressionSchema,
      flags: regexFlagsSchema.default(""),
    }),
  }),
  z.object({
    ...base,
    type: z.literal("body_contains"),
    configuration: z.object({
      text: z.string().min(1).max(65_536),
      caseSensitive: z.boolean().default(true),
    }),
  }),
  z.object({
    ...base,
    type: z.literal("body_schema"),
    configuration: z.object({
      schema: z
        .string()
        .min(2)
        .max(65_536)
        .refine((value) => {
          try {
            const parsed = JSON.parse(value) as unknown;
            return Boolean(
              parsed && typeof parsed === "object" && !Array.isArray(parsed),
            );
          } catch {
            return false;
          }
        }, "JSON Schema must be a valid JSON object."),
    }),
  }),
]);

export const assertionDefinitionsSchema = z
  .array(assertionDefinitionSchema)
  .max(100, "A request or workflow step can have at most 100 assertions.");

export type AssertionDefinition = z.infer<typeof assertionDefinitionSchema>;

export interface AssertionResult {
  assertionId: string | null;
  name: string;
  type: AssertionType;
  owner: "request" | "workflow_step";
  passed: boolean;
  message: string;
}

export function defaultAssertion(type: AssertionType): AssertionDefinition {
  const shared = { name: "New assertion", enabled: true };
  switch (type) {
    case "status_equals":
      return { ...shared, type, configuration: { expected: 200 } };
    case "status_range":
      return { ...shared, type, configuration: { minimum: 200, maximum: 299 } };
    case "duration_below":
      return { ...shared, type, configuration: { maximumMs: 1_000 } };
    case "header_exists":
      return { ...shared, type, configuration: { name: "Content-Type" } };
    case "header_equals":
      return {
        ...shared,
        type,
        configuration: {
          name: "Content-Type",
          expected: "application/json",
          caseSensitive: true,
        },
      };
    case "jsonpath_exists":
      return { ...shared, type, configuration: { path: "$.id" } };
    case "jsonpath_equals":
      return {
        ...shared,
        type,
        configuration: { path: "$.status", expected: "ok", mode: "text" },
      };
    case "jsonpath_regex":
      return {
        ...shared,
        type,
        configuration: { path: "$.id", pattern: "^.+$", flags: "" },
      };
    case "body_contains":
      return {
        ...shared,
        type,
        configuration: { text: "ok", caseSensitive: true },
      };
    case "body_schema":
      return {
        ...shared,
        type,
        configuration: {
          schema: JSON.stringify({ type: "object" }, null, 2),
        },
      };
  }
}
