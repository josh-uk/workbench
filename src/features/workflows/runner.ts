import "server-only";

import type { VariableValue } from "@/features/variables/domain";
import {
  completeWorkflowRun,
  createWorkflowRun,
  getWorkflowDetail,
  getWorkflowRunReport,
  recordWorkflowStepRun,
} from "@/features/workflows/data/workflow-repository";
import type { WorkflowRunReport } from "@/features/workflows/domain";
import { executeSavedRequest } from "@/features/requests/execution/request-executor";

function mergeRuntimeVariables(
  base: VariableValue[],
  overrides: VariableValue[],
) {
  const merged = new Map<string, VariableValue>();
  for (const variable of [...base, ...overrides]) {
    merged.set(variable.name.toLocaleLowerCase(), variable);
  }
  return [...merged.values()];
}

function errorDetail(error: unknown) {
  return {
    code: "WORKFLOW_EXECUTION_FAILED",
    message:
      error instanceof Error ? error.message : "Workflow execution failed.",
  };
}

export async function runWorkflow(input: {
  workflowId: string;
  workflowRunId: string;
  runtimeVariables?: VariableValue[];
  signal: AbortSignal;
}): Promise<WorkflowRunReport> {
  const workflow = await getWorkflowDetail(input.workflowId);
  const enabledSteps = workflow.steps.filter(({ enabled }) => enabled);
  await createWorkflowRun({
    id: input.workflowRunId,
    workflowId: workflow.id,
    projectId: workflow.projectId,
    workflowName: workflow.name,
  });

  let passed = 0;
  let failed = 0;
  let attempted = 0;
  let stoppedEarly = false;
  let cancelled = false;
  let runError: { code: string; message: string } | null = null;

  try {
    for (const step of enabledSteps) {
      if (input.signal.aborted) {
        cancelled = true;
        stoppedEarly = attempted < enabledSteps.length;
        break;
      }
      attempted += 1;
      const startedAt = new Date();
      const requestExecutionId = crypto.randomUUID();
      let execution = null;
      let stepError: { code: string; message: string } | null = null;
      try {
        execution = await executeSavedRequest({
          requestId: step.requestId,
          executionId: requestExecutionId,
          runtimeVariables: mergeRuntimeVariables(
            input.runtimeVariables ?? [],
            step.runtimeOverrides,
          ),
          workflowStepId: step.id,
          signal: input.signal,
        });
        if (execution.status !== "succeeded") {
          stepError = execution.error ?? {
            code: "REQUEST_FAILED",
            message: "The request did not complete successfully.",
          };
        } else if (execution.assertionsPassed === false) {
          stepError = {
            code: "ASSERTIONS_FAILED",
            message: `${execution.assertionResults.filter(({ passed }) => !passed).length} assertion(s) failed.`,
          };
        }
      } catch (error) {
        stepError = errorDetail(error);
      }

      const succeeded = !stepError;
      if (succeeded) passed += 1;
      else failed += 1;
      await recordWorkflowStepRun({
        workflowRunId: input.workflowRunId,
        workflowStepId: step.id,
        requestId: step.requestId,
        requestExecutionId: execution?.id ?? null,
        position: step.position,
        name: step.name,
        status: succeeded
          ? "succeeded"
          : execution?.status === "cancelled"
            ? "cancelled"
            : "failed",
        failureMode: step.failureMode,
        assertionResults: execution?.assertionResults ?? [],
        outputNames: execution?.outputs.map(({ name }) => name) ?? [],
        error: stepError,
        startedAt,
        completedAt: new Date(),
      });
      if (execution?.status === "cancelled" || input.signal.aborted) {
        cancelled = true;
        stoppedEarly = attempted < enabledSteps.length;
        break;
      }
      if (!succeeded && step.failureMode === "stop") {
        stoppedEarly = attempted < enabledSteps.length;
        break;
      }
    }
  } catch (error) {
    runError = errorDetail(error);
  }

  const status = cancelled
    ? "cancelled"
    : failed || runError
      ? "failed"
      : "succeeded";
  await completeWorkflowRun({
    id: input.workflowRunId,
    status,
    summary: {
      total: enabledSteps.length,
      attempted,
      passed,
      failed,
      stoppedEarly,
    },
    error: runError,
  });
  return getWorkflowRunReport(input.workflowRunId);
}
