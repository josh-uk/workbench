import { NextResponse } from "next/server";

import {
  completeExecution,
  createExecutionRecord,
  failExecution,
  getExecutionDetail,
  getSavedRequestDetail,
} from "@/features/requests/data/request-repository";
import {
  executeSavedRequestSchema,
  RequestDomainError,
} from "@/features/requests/domain";
import {
  registerExecution,
  unregisterExecution,
} from "@/features/requests/execution/active-executions";
import {
  createRequestSnapshot,
  executeHttpRequest,
  safeDisplayUrl,
} from "@/features/requests/execution/http-engine";

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
    const saved = await getSavedRequestDetail(requestId);
    const plan = {
      id: saved.id,
      projectId: saved.projectId,
      method: saved.method,
      url: saved.url,
      queryParameters: saved.queryParameters,
      headers: saved.headers,
      body: saved.body,
      settings: saved.settings,
    };
    let snapshot: Record<string, unknown>;
    try {
      snapshot = createRequestSnapshot(plan);
    } catch (error) {
      const domainError =
        error instanceof RequestDomainError
          ? error
          : new RequestDomainError("Request URL is invalid.", "URL_INVALID");
      await createExecutionRecord({
        id: executionId,
        projectId: saved.projectId,
        requestId: saved.id,
        method: saved.method,
        resolvedUrl: "[invalid URL]",
        requestSnapshot: { method: saved.method, url: "[invalid URL]" },
      });
      await failExecution(
        executionId,
        { code: domainError.code, message: domainError.message },
        false,
      );
      return NextResponse.json(await getExecutionDetail(executionId));
    }
    const resolvedUrl =
      typeof snapshot.url === "string"
        ? snapshot.url
        : safeDisplayUrl(saved.url);

    await createExecutionRecord({
      id: executionId,
      projectId: saved.projectId,
      requestId: saved.id,
      method: saved.method,
      resolvedUrl,
      requestSnapshot: snapshot,
    });

    const controller = new AbortController();
    registerExecution(executionId, controller);
    try {
      const response = await executeHttpRequest(plan, controller.signal);
      await completeExecution(executionId, response);
    } catch (error) {
      const domainError =
        error instanceof RequestDomainError
          ? error
          : new RequestDomainError(
              "Request execution failed.",
              "EXECUTION_FAILED",
            );
      await failExecution(
        executionId,
        { code: domainError.code, message: domainError.message },
        domainError.code === "REQUEST_CANCELLED",
      );
    } finally {
      unregisterExecution(executionId);
    }

    return NextResponse.json(await getExecutionDetail(executionId));
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
