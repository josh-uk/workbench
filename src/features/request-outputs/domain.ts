import { z } from "zod";

import { variableNameSchema } from "@/features/variables/domain";

export const requestOutputDefinitionSchema = z.object({
  name: variableNameSchema,
  jsonPath: z.string().trim().min(1, "Output JSONPath is required.").max(1_024),
  expiresInJsonPath: z.string().trim().max(1_024).nullable().default(null),
  secret: z.boolean().default(false),
});

export const requestOutputDefinitionsSchema = z
  .array(requestOutputDefinitionSchema)
  .max(100)
  .superRefine((definitions, context) => {
    const names = new Set<string>();
    for (const [index, definition] of definitions.entries()) {
      const key = definition.name.toLocaleLowerCase();
      if (names.has(key)) {
        context.addIssue({
          code: "custom",
          message: `Output ${definition.name} is duplicated.`,
          path: [index, "name"],
        });
      }
      names.add(key);
    }
  });

export type RequestOutputDefinition = z.infer<
  typeof requestOutputDefinitionSchema
>;

export interface ExtractedRequestOutput extends RequestOutputDefinition {
  definitionId: string;
  value: string;
  expiresAt: Date | null;
}

export class RequestOutputDomainError extends Error {
  constructor(
    message: string,
    public readonly code = "OUTPUT_INVALID",
  ) {
    super(message);
    this.name = "RequestOutputDomainError";
  }
}
