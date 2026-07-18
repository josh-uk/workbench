"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";

import {
  deleteAuthProfile,
  saveAuthOverride,
  saveAuthProfile,
} from "@/features/authentication/data/auth-repository";
import {
  AuthDomainError,
  authProfileIdSchema,
  saveAuthOverrideSchema,
  saveAuthProfileSchema,
} from "@/features/authentication/domain";
import type { RequestActionResult } from "@/features/requests/domain";

function failure(error: unknown): RequestActionResult<never> {
  if (error instanceof ZodError) {
    return { ok: false, error: error.issues[0]?.message ?? "Invalid input." };
  }
  if (error instanceof AuthDomainError)
    return { ok: false, error: error.message };
  console.error(
    "Authentication action failed:",
    error instanceof Error ? error.message : "Unknown error",
  );
  return {
    ok: false,
    error: "Authentication configuration could not be saved.",
  };
}

async function perform<T>(
  mutation: () => Promise<T>,
): Promise<RequestActionResult<T>> {
  try {
    const data = await mutation();
    revalidatePath("/");
    return { ok: true, data };
  } catch (error) {
    return failure(error);
  }
}

export async function saveAuthProfileAction(input: unknown) {
  return perform(() => saveAuthProfile(saveAuthProfileSchema.parse(input)));
}

export async function saveAuthOverrideAction(input: unknown) {
  return perform(() => saveAuthOverride(saveAuthOverrideSchema.parse(input)));
}

export async function deleteAuthProfileAction(input: unknown) {
  return perform(() =>
    deleteAuthProfile(authProfileIdSchema.parse(input).authProfileId),
  );
}
