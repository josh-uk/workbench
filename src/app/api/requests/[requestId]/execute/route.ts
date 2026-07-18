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
import { getVariableDefinitionsForRequest } from "@/features/variables/data/variable-repository";
import { VariableDomainError } from "@/features/variables/domain";
import { resolveRequestPlan } from "@/features/variables/resolution";

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
    const sourcePlan = {
      id: saved.id,
      projectId: saved.projectId,
      method: saved.method,
      url: saved.url,
      queryParameters: saved.queryParameters,
      headers: saved.headers,
      body: saved.body,
      settings: saved.settings,
    };
    let resolution: ReturnType<typeof resolveRequestPlan>;
    try {
      const definitions = await getVariableDefinitionsForRequest({
        requestId: saved.id,
        workspaceEnvironmentId: saved.settings.workspaceEnvironmentId,
        projectEnvironmentId: saved.settings.projectEnvironmentId,
        runtimeVariables: input.runtimeVariables,
      });
      resolution = resolveRequestPlan(sourcePlan, definitions);
    } catch (error) {
      const domainError =
        error instanceof VariableDomainError
          ? error
          : new VariableDomainError("Variables could not be resolved.");
      await createExecutionRecord({
        id: executionId,
        projectId: saved.projectId,
        requestId: saved.id,
        method: saved.method,
        resolvedUrl: saved.url,
        requestSnapshot: {
          method: saved.method,
          url: saved.url,
          variableResolution: { error: domainError.message },
        },
      });
      await failExecution(
        executionId,
        { code: domainError.code, message: domainError.message },
        false,
      );
      return NextResponse.json(await getExecutionDetail(executionId));
    }

    if (resolution.unresolved.length || resolution.errors.length) {
      const message =
        resolution.errors[0]?.message ??
        `Unresolved variables: ${resolution.unresolved.join(", ")}.`;
      await createExecutionRecord({
        id: executionId,
        projectId: saved.projectId,
        requestId: saved.id,
        method: saved.method,
        resolvedUrl: resolution.preview.url,
        requestSnapshot: {
          method: saved.method,
          url: resolution.preview.url,
          headers: resolution.preview.headers,
          variableResolution: {
            unresolved: resolution.unresolved,
            errors: resolution.errors,
          },
        },
      });
      await failExecution(
        executionId,
        {
          code: resolution.errors[0]?.code ?? "VARIABLE_UNRESOLVED",
          message,
        },
        false,
      );
      return NextResponse.json(await getExecutionDetail(executionId));
    }

    const plan = resolution.plan;
    let snapshot: Record<string, unknown>;
    try {
      snapshot = {
        ...createRequestSnapshot(plan),
        variables: resolution.variables.map((variable) => ({
          name: variable.name,
          value: variable.preview,
          origin: variable.originLabel,
          secret: variable.secret,
        })),
      };
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
      error instanceof RequestDomainError ||
      error instanceof VariableDomainError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Request could not be executed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
