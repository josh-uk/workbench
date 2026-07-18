import "server-only";

import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";

import {
  assertionDefinitionSchema,
  type AssertionResult,
} from "@/core/assertions/domain";
import { getDatabase } from "@/db/client";
import {
  assertions,
  projects,
  savedRequests,
  workflowRuns,
  workflowStepRuns,
  workflowSteps,
  workflows,
} from "@/db/schema";
import { getExecutionDetail } from "@/features/requests/data/request-repository";
import { runtimeVariablesSchema } from "@/features/variables/domain";
import {
  type WorkflowDetail,
  WorkflowDomainError,
  type WorkflowRunReport,
  type WorkflowStatus,
  type WorkflowSummary,
  saveWorkflowSchema,
} from "@/features/workflows/domain";

type Database = ReturnType<typeof getDatabase>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Transaction;

async function getWorkflowRow(executor: Executor, id: string) {
  const [workflow] = await executor
    .select()
    .from(workflows)
    .where(eq(workflows.id, id))
    .limit(1);
  if (!workflow) {
    throw new WorkflowDomainError("Workflow not found.", "WORKFLOW_NOT_FOUND");
  }
  return workflow;
}

async function assertProject(executor: Executor, projectId: string) {
  const [project] = await executor
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) {
    throw new WorkflowDomainError("Project not found.", "PROJECT_NOT_FOUND");
  }
}

async function assertNameAvailable(
  executor: Executor,
  projectId: string,
  name: string,
  excludeId?: string,
) {
  const conditions = [
    eq(workflows.projectId, projectId),
    sql`lower(${workflows.name}) = lower(${name})`,
  ];
  if (excludeId) conditions.push(ne(workflows.id, excludeId));
  const [existing] = await executor
    .select({ id: workflows.id })
    .from(workflows)
    .where(and(...conditions))
    .limit(1);
  if (existing) {
    throw new WorkflowDomainError(
      "A workflow with this name already exists in the project.",
      "WORKFLOW_NAME_CONFLICT",
    );
  }
}

async function availableRequests(executor: Executor, projectId: string) {
  return executor
    .select({
      id: savedRequests.id,
      name: savedRequests.name,
      method: savedRequests.method,
    })
    .from(savedRequests)
    .where(eq(savedRequests.projectId, projectId))
    .orderBy(asc(savedRequests.name));
}

export async function listWorkflows(
  projectId: string,
): Promise<WorkflowSummary[]> {
  const database = getDatabase();
  await assertProject(database, projectId);
  const [workflowRows, stepRows, runRows] = await Promise.all([
    database
      .select()
      .from(workflows)
      .where(eq(workflows.projectId, projectId))
      .orderBy(asc(workflows.name)),
    database
      .select({ workflowId: workflowSteps.workflowId })
      .from(workflowSteps)
      .innerJoin(workflows, eq(workflows.id, workflowSteps.workflowId))
      .where(eq(workflows.projectId, projectId)),
    database
      .select({
        id: workflowRuns.id,
        workflowId: workflowRuns.workflowId,
        status: workflowRuns.status,
        createdAt: workflowRuns.createdAt,
      })
      .from(workflowRuns)
      .where(eq(workflowRuns.projectId, projectId))
      .orderBy(desc(workflowRuns.createdAt)),
  ]);
  return workflowRows.map((workflow) => {
    const lastRun = runRows.find((run) => run.workflowId === workflow.id);
    return {
      id: workflow.id,
      projectId: workflow.projectId,
      name: workflow.name,
      description: workflow.description,
      stepCount: stepRows.filter((step) => step.workflowId === workflow.id)
        .length,
      lastRun: lastRun
        ? {
            id: lastRun.id,
            status: lastRun.status,
            createdAt: lastRun.createdAt.toISOString(),
          }
        : null,
    };
  });
}

export async function getWorkflowDetail(id: string): Promise<WorkflowDetail> {
  const database = getDatabase();
  const workflow = await getWorkflowRow(database, id);
  const [stepRows, requestRows, runRows] = await Promise.all([
    database
      .select({ step: workflowSteps, request: savedRequests })
      .from(workflowSteps)
      .innerJoin(savedRequests, eq(savedRequests.id, workflowSteps.requestId))
      .where(eq(workflowSteps.workflowId, id))
      .orderBy(asc(workflowSteps.position)),
    availableRequests(database, workflow.projectId),
    database
      .select({
        id: workflowRuns.id,
        status: workflowRuns.status,
        createdAt: workflowRuns.createdAt,
      })
      .from(workflowRuns)
      .where(eq(workflowRuns.workflowId, id))
      .orderBy(desc(workflowRuns.createdAt))
      .limit(1),
  ]);
  const stepIds = stepRows.map(({ step }) => step.id);
  const assertionRows = stepIds.length
    ? await database
        .select()
        .from(assertions)
        .where(inArray(assertions.workflowStepId, stepIds))
        .orderBy(asc(assertions.position))
    : [];
  const lastRun = runRows[0];
  return {
    id: workflow.id,
    projectId: workflow.projectId,
    name: workflow.name,
    description: workflow.description,
    stepCount: stepRows.length,
    lastRun: lastRun
      ? {
          id: lastRun.id,
          status: lastRun.status,
          createdAt: lastRun.createdAt.toISOString(),
        }
      : null,
    availableRequests: requestRows,
    steps: stepRows.map(({ step, request }) => ({
      id: step.id,
      requestId: step.requestId,
      requestName: request.name,
      requestMethod: request.method,
      name: step.name || request.name,
      position: step.position,
      failureMode: step.failureMode,
      enabled: step.enabled,
      runtimeOverrides: runtimeVariablesSchema.parse(
        Array.isArray(step.runtimeOverrides) ? step.runtimeOverrides : [],
      ),
      assertions: assertionRows
        .filter(({ workflowStepId }) => workflowStepId === step.id)
        .map((assertion) =>
          assertionDefinitionSchema.parse({
            id: assertion.id,
            name: assertion.name,
            type: assertion.type,
            configuration: assertion.configuration,
            enabled: assertion.enabled,
          }),
        ),
    })),
  };
}

export async function saveWorkflow(input: unknown) {
  const values = saveWorkflowSchema.parse(input);
  const database = getDatabase();
  return database.transaction(async (transaction) => {
    await assertProject(transaction, values.projectId);
    if (values.id) {
      const existing = await getWorkflowRow(transaction, values.id);
      if (existing.projectId !== values.projectId) {
        throw new WorkflowDomainError(
          "Workflow belongs to another project.",
          "WORKFLOW_PROJECT_MISMATCH",
        );
      }
    }
    await assertNameAvailable(
      transaction,
      values.projectId,
      values.name,
      values.id,
    );
    const requestIds = [
      ...new Set(values.steps.map(({ requestId }) => requestId)),
    ];
    const requestRows = await transaction
      .select({ id: savedRequests.id })
      .from(savedRequests)
      .where(
        and(
          eq(savedRequests.projectId, values.projectId),
          inArray(savedRequests.id, requestIds),
        ),
      );
    if (requestRows.length !== requestIds.length) {
      throw new WorkflowDomainError(
        "Every workflow step must reference a request in this project.",
        "WORKFLOW_REQUEST_SCOPE_INVALID",
      );
    }

    let workflowId = values.id;
    if (workflowId) {
      await transaction
        .update(workflows)
        .set({
          name: values.name,
          description: values.description,
          updatedAt: new Date(),
        })
        .where(eq(workflows.id, workflowId));
      await transaction
        .delete(workflowSteps)
        .where(eq(workflowSteps.workflowId, workflowId));
    } else {
      const [created] = await transaction
        .insert(workflows)
        .values({
          projectId: values.projectId,
          name: values.name,
          description: values.description,
        })
        .returning({ id: workflows.id });
      if (!created)
        throw new WorkflowDomainError("Workflow could not be saved.");
      workflowId = created.id;
    }

    const stepRows = await transaction
      .insert(workflowSteps)
      .values(
        values.steps.map((step, position) => ({
          workflowId,
          requestId: step.requestId,
          name: step.name,
          position,
          failureMode: step.failureMode,
          enabled: step.enabled,
          runtimeOverrides: step.runtimeOverrides,
        })),
      )
      .returning({ id: workflowSteps.id, position: workflowSteps.position });
    const assertionValues = stepRows.flatMap((stepRow) =>
      values.steps[stepRow.position]!.assertions.map((assertion, position) => ({
        workflowStepId: stepRow.id,
        name: assertion.name,
        type: assertion.type,
        configuration: assertion.configuration,
        position,
        enabled: assertion.enabled,
      })),
    );
    if (assertionValues.length) {
      await transaction.insert(assertions).values(assertionValues);
    }
    return { id: workflowId };
  });
}

export async function deleteWorkflow(id: string) {
  const database = getDatabase();
  await getWorkflowRow(database, id);
  await database.delete(workflows).where(eq(workflows.id, id));
}

export async function createWorkflowRun(input: {
  id: string;
  workflowId: string;
  projectId: string;
  workflowName: string;
}) {
  await getDatabase()
    .insert(workflowRuns)
    .values({
      ...input,
      status: "running",
      startedAt: new Date(),
    });
}

export async function recordWorkflowStepRun(input: {
  workflowRunId: string;
  workflowStepId: string;
  requestId: string;
  requestExecutionId: string | null;
  position: number;
  name: string;
  status: WorkflowStatus;
  failureMode: "stop" | "continue";
  assertionResults: AssertionResult[];
  outputNames: string[];
  error: { code: string; message: string } | null;
  startedAt: Date;
  completedAt: Date;
}) {
  await getDatabase().insert(workflowStepRuns).values(input);
}

export async function completeWorkflowRun(input: {
  id: string;
  status: WorkflowStatus;
  summary: WorkflowRunReport["summary"];
  error?: { code: string; message: string } | null;
}) {
  await getDatabase()
    .update(workflowRuns)
    .set({
      status: input.status,
      summary: input.summary,
      error: input.error ?? null,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(workflowRuns.id, input.id));
}

export async function getWorkflowRunReport(
  id: string,
): Promise<WorkflowRunReport> {
  const database = getDatabase();
  const [run] = await database
    .select()
    .from(workflowRuns)
    .where(eq(workflowRuns.id, id))
    .limit(1);
  if (!run) {
    throw new WorkflowDomainError(
      "Workflow run not found.",
      "WORKFLOW_RUN_NOT_FOUND",
    );
  }
  const stepRows = await database
    .select()
    .from(workflowStepRuns)
    .where(eq(workflowStepRuns.workflowRunId, id))
    .orderBy(asc(workflowStepRuns.position));
  const steps = await Promise.all(
    stepRows.map(async (step) => ({
      id: step.id,
      workflowStepId: step.workflowStepId,
      requestId: step.requestId,
      position: step.position,
      name: step.name,
      status: step.status,
      failureMode: step.failureMode,
      assertionResults: step.assertionResults as AssertionResult[],
      outputNames: step.outputNames,
      error: step.error as { code: string; message: string } | null,
      startedAt: step.startedAt?.toISOString() ?? null,
      completedAt: step.completedAt?.toISOString() ?? null,
      execution: step.requestExecutionId
        ? await getExecutionDetail(step.requestExecutionId).catch(() => null)
        : null,
    })),
  );
  return {
    id: run.id,
    workflowId: run.workflowId,
    projectId: run.projectId,
    workflowName: run.workflowName,
    status: run.status,
    summary: run.summary as WorkflowRunReport["summary"],
    error: run.error as { code: string; message: string } | null,
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
    steps,
  };
}
