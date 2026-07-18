"use server";

import { revalidatePath } from "next/cache";
import { ZodError, type ZodType } from "zod";

import {
  createEnvironment,
  deleteEnvironment,
  duplicateEnvironment,
  saveVariableScope,
  updateEnvironment,
} from "@/features/variables/data/variable-repository";
import {
  createEnvironmentSchema,
  environmentIdSchema,
  saveVariableScopeSchema,
  updateEnvironmentSchema,
  VariableDomainError,
} from "@/features/variables/domain";
import type { ActionResult } from "@/features/workspaces/domain";

function failure(error: unknown): ActionResult<never> {
  if (error instanceof ZodError) {
    return { ok: false, error: error.issues[0]?.message ?? "Invalid input." };
  }
  if (error instanceof VariableDomainError) {
    return { ok: false, error: error.message };
  }
  console.error(
    "Variable action failed:",
    error instanceof Error ? error.message : "Unknown error",
  );
  return { ok: false, error: "The variable change could not be saved." };
}

async function perform<TInput, TOutput = undefined>(
  schema: ZodType<TInput>,
  input: unknown,
  mutation: (values: TInput) => Promise<TOutput>,
): Promise<ActionResult<TOutput>> {
  try {
    const values = schema.parse(input);
    const data = await mutation(values);
    revalidatePath("/");
    return { ok: true, data };
  } catch (error) {
    return failure(error);
  }
}

export async function createEnvironmentAction(input: unknown) {
  return perform(createEnvironmentSchema, input, createEnvironment);
}

export async function updateEnvironmentAction(input: unknown) {
  return perform(updateEnvironmentSchema, input, ({ id, ...values }) =>
    updateEnvironment(id, values),
  );
}

export async function duplicateEnvironmentAction(input: unknown) {
  return perform(environmentIdSchema, input, ({ environmentId }) =>
    duplicateEnvironment(environmentId),
  );
}

export async function deleteEnvironmentAction(input: unknown) {
  return perform(environmentIdSchema, input, ({ environmentId }) =>
    deleteEnvironment(environmentId),
  );
}

export async function saveVariableScopeAction(input: unknown) {
  return perform(saveVariableScopeSchema, input, saveVariableScope);
}
