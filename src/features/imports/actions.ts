"use server";

import { revalidatePath } from "next/cache";
import { type output, ZodError, type ZodType } from "zod";

import {
  executeCollectionImport,
  listCollectionImports,
  previewCollectionImport,
} from "./data/import-repository";
import {
  type CollectionImportActionResult,
  CollectionImportError,
  executeCollectionImportSchema,
  previewCollectionImportSchema,
} from "./domain";
import { importCollectionSource } from "./registry";
import { projectIdSchema } from "../workspaces/domain";

function failure(error: unknown): CollectionImportActionResult<never> {
  if (error instanceof ZodError) {
    return { ok: false, error: error.issues[0]?.message ?? "Invalid input." };
  }
  if (error instanceof CollectionImportError) {
    return { ok: false, error: error.message };
  }
  console.error(
    "Collection import action failed:",
    error instanceof Error ? error.name : "Unknown error",
  );
  return { ok: false, error: "The collection import could not be completed." };
}

async function perform<TSchema extends ZodType, TResult>(
  schema: TSchema,
  input: unknown,
  operation: (values: output<TSchema>) => Promise<TResult>,
): Promise<CollectionImportActionResult<TResult>> {
  try {
    return { ok: true, data: await operation(schema.parse(input)) };
  } catch (error) {
    return failure(error);
  }
}

export async function previewCollectionImportAction(input: unknown) {
  return perform(previewCollectionImportSchema, input, (values) =>
    previewCollectionImport(
      values.projectId,
      importCollectionSource(values.source.content, values.source.format),
    ),
  );
}

export async function executeCollectionImportAction(input: unknown) {
  return perform(executeCollectionImportSchema, input, async (values) => {
    const plan = importCollectionSource(
      values.source.content,
      values.source.format,
    );
    const result = await executeCollectionImport({
      projectId: values.projectId,
      plan,
      approvedSourceHash: values.previewSourceHash,
      sourceType: values.source.sourceType,
      originalDocument: values.source.content,
      options: values.options,
    });
    revalidatePath("/");
    return result;
  });
}

export async function listCollectionImportsAction(input: unknown) {
  return perform(projectIdSchema, input, ({ projectId }) =>
    listCollectionImports(projectId),
  );
}
