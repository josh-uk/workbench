"use server";

import { revalidatePath } from "next/cache";
import { type output, ZodError, type ZodType } from "zod";

import {
  deleteWorkflow,
  getWorkflowDetail,
  getWorkflowRunReport,
  listWorkflows,
  saveWorkflow,
} from "@/features/workflows/data/workflow-repository";
import {
  type WorkflowActionResult,
  WorkflowDomainError,
  workflowIdSchema,
  workflowProjectSchema,
  workflowRunIdSchema,
  saveWorkflowSchema,
} from "@/features/workflows/domain";

function failure(error: unknown): WorkflowActionResult<never> {
  if (error instanceof ZodError) {
    return { ok: false, error: error.issues[0]?.message ?? "Invalid input." };
  }
  if (error instanceof WorkflowDomainError) {
    return { ok: false, error: error.message };
  }
  console.error(
    "Workflow action failed:",
    error instanceof Error ? error.name : "Unknown error",
  );
  return { ok: false, error: "The workflow change could not be completed." };
}

async function perform<TSchema extends ZodType, TResult>(
  schema: TSchema,
  input: unknown,
  operation: (values: output<TSchema>) => Promise<TResult>,
  mutate = false,
): Promise<WorkflowActionResult<TResult>> {
  try {
    const data = await operation(schema.parse(input));
    if (mutate) revalidatePath("/");
    return { ok: true, data };
  } catch (error) {
    return failure(error);
  }
}

export async function listWorkflowsAction(input: unknown) {
  return perform(workflowProjectSchema, input, ({ projectId }) =>
    listWorkflows(projectId),
  );
}

export async function getWorkflowDetailAction(input: unknown) {
  return perform(workflowIdSchema, input, ({ workflowId }) =>
    getWorkflowDetail(workflowId),
  );
}

export async function getWorkflowRunReportAction(input: unknown) {
  return perform(workflowRunIdSchema, input, ({ workflowRunId }) =>
    getWorkflowRunReport(workflowRunId),
  );
}

export async function saveWorkflowAction(input: unknown) {
  return perform(saveWorkflowSchema, input, saveWorkflow, true);
}

export async function deleteWorkflowAction(input: unknown) {
  return perform(
    workflowIdSchema,
    input,
    ({ workflowId }) => deleteWorkflow(workflowId),
    true,
  );
}
