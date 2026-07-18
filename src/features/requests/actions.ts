"use server";

import { revalidatePath } from "next/cache";
import { ZodError, type ZodType } from "zod";

import {
  createSavedRequest,
  deleteSavedRequest,
  duplicateSavedRequest,
  moveSavedRequest,
  relocateSavedRequest,
  updateSavedRequest,
} from "@/features/requests/data/request-repository";
import {
  createSavedRequestSchema,
  moveSavedRequestSchema,
  relocateSavedRequestSchema,
  type RequestActionResult,
  RequestDomainError,
  requestIdSchema,
  updateSavedRequestSchema,
} from "@/features/requests/domain";

function failure(error: unknown): RequestActionResult<never> {
  if (error instanceof ZodError) {
    return { ok: false, error: error.issues[0]?.message ?? "Invalid input." };
  }
  if (error instanceof RequestDomainError) {
    return { ok: false, error: error.message };
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  ) {
    return { ok: false, error: "That request name is already in use." };
  }
  console.error(
    "Request action failed:",
    error instanceof Error ? error.message : "Unknown error",
  );
  return { ok: false, error: "The request change could not be saved." };
}

async function perform<TInput, TOutput = undefined>(
  schema: ZodType<TInput>,
  input: unknown,
  mutation: (values: TInput) => Promise<TOutput>,
): Promise<RequestActionResult<TOutput>> {
  try {
    const values = schema.parse(input);
    const data = await mutation(values);
    revalidatePath("/");
    return { ok: true, data };
  } catch (error) {
    return failure(error);
  }
}

export async function createSavedRequestAction(input: unknown) {
  return perform(createSavedRequestSchema, input, createSavedRequest);
}

export async function updateSavedRequestAction(input: unknown) {
  return perform(updateSavedRequestSchema, input, updateSavedRequest);
}

export async function duplicateSavedRequestAction(input: unknown) {
  return perform(requestIdSchema, input, ({ requestId }) =>
    duplicateSavedRequest(requestId),
  );
}

export async function deleteSavedRequestAction(input: unknown) {
  return perform(requestIdSchema, input, ({ requestId }) =>
    deleteSavedRequest(requestId),
  );
}

export async function moveSavedRequestAction(input: unknown) {
  return perform(moveSavedRequestSchema, input, ({ requestId, direction }) =>
    moveSavedRequest(requestId, direction),
  );
}

export async function relocateSavedRequestAction(input: unknown) {
  return perform(relocateSavedRequestSchema, input, ({ requestId, folderId }) =>
    relocateSavedRequest(requestId, folderId),
  );
}
