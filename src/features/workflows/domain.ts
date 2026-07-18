import { z } from "zod";

import {
  assertionDefinitionsSchema,
  type AssertionDefinition,
  type AssertionResult,
} from "@/core/assertions/domain";
import type { ExecutionDetail } from "@/features/requests/domain";
import {
  runtimeVariablesSchema,
  type VariableValue,
} from "@/features/variables/domain";
import {
  entityDescriptionSchema,
  entityIdSchema,
  entityNameSchema,
} from "@/features/workspaces/domain";

export const workflowFailureModeSchema = z.enum(["stop", "continue"]);

export const workflowStepInputSchema = z.object({
  id: entityIdSchema.optional(),
  requestId: entityIdSchema,
  name: entityNameSchema,
  failureMode: workflowFailureModeSchema.default("stop"),
  enabled: z.boolean().default(true),
  runtimeOverrides: runtimeVariablesSchema,
  assertions: assertionDefinitionsSchema.default([]),
});

export const saveWorkflowSchema = z
  .object({
    id: entityIdSchema.optional(),
    projectId: entityIdSchema,
    name: entityNameSchema,
    description: entityDescriptionSchema.nullable().default(""),
    steps: z
      .array(workflowStepInputSchema)
      .min(1, "Add at least one workflow step.")
      .max(100, "A workflow can contain at most 100 steps."),
  })
  .refine(({ steps }) => steps.some(({ enabled }) => enabled), {
    message: "Enable at least one workflow step.",
    path: ["steps"],
  });

export const workflowIdSchema = z.object({ workflowId: entityIdSchema });
export const workflowRunIdSchema = z.object({ workflowRunId: entityIdSchema });
export const workflowProjectSchema = z.object({ projectId: entityIdSchema });
export const executeWorkflowSchema = z.object({
  workflowRunId: entityIdSchema,
  runtimeVariables: runtimeVariablesSchema,
});

export type WorkflowStatus =
  "pending" | "running" | "succeeded" | "failed" | "cancelled";

export interface WorkflowRequestOption {
  id: string;
  name: string;
  method: string;
}

export interface WorkflowStepDetail {
  id: string;
  requestId: string;
  requestName: string;
  requestMethod: string;
  name: string;
  position: number;
  failureMode: "stop" | "continue";
  enabled: boolean;
  runtimeOverrides: VariableValue[];
  assertions: AssertionDefinition[];
}

export interface WorkflowSummary {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  stepCount: number;
  lastRun: { id: string; status: WorkflowStatus; createdAt: string } | null;
}

export interface WorkflowDetail extends WorkflowSummary {
  steps: WorkflowStepDetail[];
  availableRequests: WorkflowRequestOption[];
}

export interface WorkflowStepReport {
  id: string;
  workflowStepId: string | null;
  requestId: string | null;
  position: number;
  name: string;
  status: WorkflowStatus;
  failureMode: "stop" | "continue";
  assertionResults: AssertionResult[];
  outputNames: string[];
  error: { code: string; message: string } | null;
  startedAt: string | null;
  completedAt: string | null;
  execution: ExecutionDetail | null;
}

export interface WorkflowRunReport {
  id: string;
  workflowId: string | null;
  projectId: string;
  workflowName: string;
  status: WorkflowStatus;
  summary: {
    total: number;
    attempted: number;
    passed: number;
    failed: number;
    stoppedEarly: boolean;
  };
  error: { code: string; message: string } | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  steps: WorkflowStepReport[];
}

export type WorkflowActionResult<T = undefined> =
  { ok: true; data: T } | { ok: false; error: string };

export class WorkflowDomainError extends Error {
  constructor(
    message: string,
    public readonly code = "WORKFLOW_INVALID",
  ) {
    super(message);
    this.name = "WorkflowDomainError";
  }
}
