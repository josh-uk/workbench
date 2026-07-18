"use server";

import { revalidatePath } from "next/cache";
import { type output, ZodError, type ZodType } from "zod";

import { RequestDomainError } from "@/features/requests/domain";

import {
  applyOpenApiRefresh,
  detachImportedRequest,
  executeOpenApiImport,
  listImportedDefinitions,
  previewOpenApiImport,
  previewOpenApiRefresh,
} from "./data/openapi-repository";
import {
  applyOpenApiRefreshSchema,
  executeOpenApiImportSchema,
  type OpenApiActionResult,
  OpenApiDomainError,
  importedRequestIdSchema,
  previewOpenApiImportSchema,
  previewOpenApiRefreshSchema,
} from "./domain";
import { parseOpenApiDocument } from "./parser";
import { loadOpenApiSource } from "./source-loader";
import { projectIdSchema } from "../workspaces/domain";

function failure(error: unknown): OpenApiActionResult<never> {
  if (error instanceof ZodError) {
    return { ok: false, error: error.issues[0]?.message ?? "Invalid input." };
  }
  if (
    error instanceof OpenApiDomainError ||
    error instanceof RequestDomainError
  ) {
    return { ok: false, error: error.message };
  }
  console.error(
    "OpenAPI action failed:",
    error instanceof Error ? error.name : "Unknown error",
  );
  return { ok: false, error: "The OpenAPI operation could not be completed." };
}

async function perform<TSchema extends ZodType, TResult>(
  schema: TSchema,
  input: unknown,
  operation: (values: output<TSchema>) => Promise<TResult>,
): Promise<OpenApiActionResult<TResult>> {
  try {
    return { ok: true, data: await operation(schema.parse(input)) };
  } catch (error) {
    return failure(error);
  }
}

export async function previewOpenApiImportAction(input: unknown) {
  return perform(previewOpenApiImportSchema, input, async (values) => {
    const content = await loadOpenApiSource(values.source);
    return previewOpenApiImport(
      values.projectId,
      parseOpenApiDocument(content),
    );
  });
}

export async function executeOpenApiImportAction(input: unknown) {
  return perform(executeOpenApiImportSchema, input, async (values) => {
    const content = await loadOpenApiSource(values.source);
    const result = await executeOpenApiImport({
      projectId: values.projectId,
      parsed: parseOpenApiDocument(content),
      source: {
        sourceType: values.source.sourceType,
        sourceUrl: values.source.sourceUrl ?? null,
        allowPrivateNetwork: values.source.allowPrivateNetwork,
      },
      options: values.options,
    });
    revalidatePath("/");
    return result;
  });
}

export async function listImportedDefinitionsAction(input: unknown) {
  return perform(projectIdSchema, input, ({ projectId }) =>
    listImportedDefinitions(projectId),
  );
}

export async function previewOpenApiRefreshAction(input: unknown) {
  return perform(previewOpenApiRefreshSchema, input, async (values) => {
    const content = await loadOpenApiSource(values.source);
    return previewOpenApiRefresh(
      values.definitionId,
      parseOpenApiDocument(content),
    );
  });
}

export async function applyOpenApiRefreshAction(input: unknown) {
  return perform(applyOpenApiRefreshSchema, input, async (values) => {
    const content = await loadOpenApiSource(values.source);
    const result = await applyOpenApiRefresh({
      definitionId: values.definitionId,
      parsed: parseOpenApiDocument(content),
      source: {
        sourceType: values.source.sourceType,
        sourceUrl: values.source.sourceUrl ?? null,
        allowPrivateNetwork: values.source.allowPrivateNetwork,
      },
      selectedChangeKeys: values.selectedChangeKeys,
    });
    revalidatePath("/");
    return result;
  });
}

export async function detachImportedRequestAction(input: unknown) {
  return perform(importedRequestIdSchema, input, async ({ requestId }) => {
    await detachImportedRequest(requestId);
    revalidatePath("/");
  });
}
