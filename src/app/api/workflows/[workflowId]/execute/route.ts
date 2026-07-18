import { NextResponse } from "next/server";

import {
  executeWorkflowSchema,
  WorkflowDomainError,
} from "@/features/workflows/domain";
import { runWorkflow } from "@/features/workflows/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ workflowId: string }> },
) {
  try {
    const { workflowId } = await context.params;
    const input = executeWorkflowSchema.parse(await request.json());
    return NextResponse.json(
      await runWorkflow({
        workflowId,
        workflowRunId: input.workflowRunId,
        runtimeVariables: input.runtimeVariables,
        signal: request.signal,
      }),
    );
  } catch (error) {
    const message =
      error instanceof WorkflowDomainError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Workflow could not be executed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
