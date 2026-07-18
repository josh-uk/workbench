import { NextResponse } from "next/server";

import {
  executeSavedRequestSchema,
  RequestDomainError,
} from "@/features/requests/domain";
import {
  registerExecution,
  unregisterExecution,
} from "@/features/requests/execution/active-executions";
import { executeSavedRequest } from "@/features/requests/execution/request-executor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ requestId: string }> },
) {
  let executionId: string | null = null;
  try {
    const { requestId } = await context.params;
    const input = executeSavedRequestSchema.parse(await request.json());
    executionId = input.executionId;
    const controller = new AbortController();
    registerExecution(executionId, controller);
    try {
      return NextResponse.json(
        await executeSavedRequest({
          requestId,
          executionId,
          runtimeVariables: input.runtimeVariables,
          signal: controller.signal,
        }),
      );
    } finally {
      unregisterExecution(executionId);
    }
  } catch (error) {
    if (executionId) unregisterExecution(executionId);
    const message =
      error instanceof RequestDomainError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Request could not be executed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
