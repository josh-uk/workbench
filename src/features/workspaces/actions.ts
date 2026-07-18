"use server";

import { revalidatePath } from "next/cache";
import { ZodError, type ZodType } from "zod";

import {
  createFolder,
  createProject,
  createWorkspace,
  deleteFolder,
  deleteProject,
  deleteWorkspace,
  duplicateProject,
  duplicateWorkspace,
  moveFolder,
  moveProject,
  relocateFolder,
  selectWorkspace,
  setProjectArchived,
  updateFolder,
  updateProject,
  updateWorkspace,
} from "@/features/workspaces/data/workspace-repository";
import {
  type ActionResult,
  createFolderSchema,
  createProjectSchema,
  createWorkspaceSchema,
  folderIdSchema,
  moveFolderSchema,
  moveProjectSchema,
  projectIdSchema,
  relocateFolderSchema,
  updateFolderSchema,
  updateProjectSchema,
  updateWorkspaceSchema,
  workspaceIdSchema,
  WorkspaceDomainError,
} from "@/features/workspaces/domain";

function failure(error: unknown): ActionResult<never> {
  if (error instanceof ZodError) {
    return { ok: false, error: error.issues[0]?.message ?? "Invalid input." };
  }

  if (error instanceof WorkspaceDomainError) {
    return { ok: false, error: error.message };
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  ) {
    return { ok: false, error: "That name is already in use." };
  }

  console.error(
    "Workspace action failed:",
    error instanceof Error ? error.message : "Unknown error",
  );
  return {
    ok: false,
    error: "The change could not be saved. Please try again.",
  };
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

export async function createWorkspaceAction(input: unknown) {
  return perform(createWorkspaceSchema, input, createWorkspace);
}

export async function updateWorkspaceAction(input: unknown) {
  return perform(updateWorkspaceSchema, input, ({ id, ...values }) =>
    updateWorkspace(id, values),
  );
}

export async function selectWorkspaceAction(input: unknown) {
  return perform(workspaceIdSchema, input, ({ workspaceId }) =>
    selectWorkspace(workspaceId),
  );
}

export async function duplicateWorkspaceAction(input: unknown) {
  return perform(workspaceIdSchema, input, ({ workspaceId }) =>
    duplicateWorkspace(workspaceId),
  );
}

export async function deleteWorkspaceAction(input: unknown) {
  return perform(workspaceIdSchema, input, ({ workspaceId }) =>
    deleteWorkspace(workspaceId),
  );
}

export async function createProjectAction(input: unknown) {
  return perform(createProjectSchema, input, createProject);
}

export async function updateProjectAction(input: unknown) {
  return perform(updateProjectSchema, input, ({ id, ...values }) =>
    updateProject(id, values),
  );
}

export async function duplicateProjectAction(input: unknown) {
  return perform(projectIdSchema, input, ({ projectId }) =>
    duplicateProject(projectId),
  );
}

export async function archiveProjectAction(input: unknown) {
  return perform(projectIdSchema, input, ({ projectId }) =>
    setProjectArchived(projectId, true),
  );
}

export async function restoreProjectAction(input: unknown) {
  return perform(projectIdSchema, input, ({ projectId }) =>
    setProjectArchived(projectId, false),
  );
}

export async function deleteProjectAction(input: unknown) {
  return perform(projectIdSchema, input, ({ projectId }) =>
    deleteProject(projectId),
  );
}

export async function moveProjectAction(input: unknown) {
  return perform(moveProjectSchema, input, ({ projectId, direction }) =>
    moveProject(projectId, direction),
  );
}

export async function createFolderAction(input: unknown) {
  return perform(createFolderSchema, input, createFolder);
}

export async function updateFolderAction(input: unknown) {
  return perform(updateFolderSchema, input, ({ id, name }) =>
    updateFolder(id, name),
  );
}

export async function deleteFolderAction(input: unknown) {
  return perform(folderIdSchema, input, ({ folderId }) =>
    deleteFolder(folderId),
  );
}

export async function moveFolderAction(input: unknown) {
  return perform(moveFolderSchema, input, ({ folderId, direction }) =>
    moveFolder(folderId, direction),
  );
}

export async function relocateFolderAction(input: unknown) {
  return perform(relocateFolderSchema, input, ({ folderId, parentId }) =>
    relocateFolder(folderId, parentId),
  );
}
