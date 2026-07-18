import "server-only";

import { resolveAuthentication } from "@/features/authentication/resolution";
import { AuthDomainError } from "@/features/authentication/domain";
import {
  getLatestGeneratedVariables,
  persistRequestOutputs,
  redactExtractedOutputs,
} from "@/features/request-outputs/data/request-output-repository";
import { RequestOutputDomainError } from "@/features/request-outputs/domain";
import {
  completeExecution,
  createExecutionRecord,
  failExecution,
  getExecutionDetail,
  getSavedRequestDetail,
} from "@/features/requests/data/request-repository";
import { RequestDomainError } from "@/features/requests/domain";
import { getVariableDefinitionsForRequest } from "@/features/variables/data/variable-repository";
import {
  type VariableValue,
  VariableDomainError,
} from "@/features/variables/domain";
import { resolveRequestPlan } from "@/features/variables/resolution";

import {
  createRequestSnapshot,
  executeHttpRequest,
  safeDisplayUrl,
} from "./http-engine";

function executionError(error: unknown) {
  if (
    error instanceof RequestDomainError ||
    error instanceof VariableDomainError ||
    error instanceof AuthDomainError ||
    error instanceof RequestOutputDomainError
  ) {
    return { code: error.code, message: error.message };
  }
  return {
    code: "EXECUTION_FAILED",
    message:
      error instanceof Error ? error.message : "Request execution failed.",
  };
}

async function recordFailure(input: {
  executionId: string;
  projectId: string;
  requestId: string;
  method: string;
  resolvedUrl: string;
  snapshot: Record<string, unknown>;
  error: unknown;
}) {
  const domainError = executionError(input.error);
  await createExecutionRecord({
    id: input.executionId,
    projectId: input.projectId,
    requestId: input.requestId,
    method: input.method,
    resolvedUrl: input.resolvedUrl,
    requestSnapshot: input.snapshot,
  });
  await failExecution(
    input.executionId,
    domainError,
    domainError.code === "REQUEST_CANCELLED",
  );
  return getExecutionDetail(input.executionId);
}

export async function executeSavedRequest(input: {
  requestId: string;
  executionId: string;
  runtimeVariables?: VariableValue[];
  signal: AbortSignal;
  stack?: string[];
}) {
  const stack = input.stack ?? [];
  if (stack.includes(input.requestId)) {
    throw new AuthDomainError(
      "Authentication token requests contain a dependency cycle.",
      "AUTH_REQUEST_CYCLE",
    );
  }
  const saved = await getSavedRequestDetail(input.requestId);
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

  let definitions;
  let resolution: ReturnType<typeof resolveRequestPlan>;
  try {
    const generatedVariables = await getLatestGeneratedVariables(
      saved.projectId,
    );
    definitions = await getVariableDefinitionsForRequest({
      requestId: saved.id,
      workspaceEnvironmentId: saved.settings.workspaceEnvironmentId,
      projectEnvironmentId: saved.settings.projectEnvironmentId,
      runtimeVariables: input.runtimeVariables ?? [],
      generatedVariables,
    });
    resolution = resolveRequestPlan(sourcePlan, definitions);
  } catch (error) {
    return recordFailure({
      executionId: input.executionId,
      projectId: saved.projectId,
      requestId: saved.id,
      method: saved.method,
      resolvedUrl: saved.url,
      snapshot: {
        method: saved.method,
        url: saved.url,
        variableResolution: { error: executionError(error).message },
      },
      error,
    });
  }

  if (resolution.unresolved.length || resolution.errors.length) {
    const error = new VariableDomainError(
      resolution.errors[0]?.message ??
        `Unresolved variables: ${resolution.unresolved.join(", ")}.`,
      resolution.errors[0]?.code ?? "VARIABLE_UNRESOLVED",
    );
    return recordFailure({
      executionId: input.executionId,
      projectId: saved.projectId,
      requestId: saved.id,
      method: saved.method,
      resolvedUrl: resolution.preview.url,
      snapshot: {
        method: saved.method,
        url: resolution.preview.url,
        headers: resolution.preview.headers,
        variableResolution: {
          unresolved: resolution.unresolved,
          errors: resolution.errors,
        },
      },
      error,
    });
  }

  let plan = resolution.plan;
  let authenticationTrace = null;
  try {
    const authentication = await resolveAuthentication({
      authProfileId: saved.authProfileId,
      projectId: saved.projectId,
      plan,
      variableDefinitions: definitions,
      signal: input.signal,
      executeTokenRequest: async (requestId) => {
        const tokenExecution = await executeSavedRequest({
          requestId,
          executionId: crypto.randomUUID(),
          runtimeVariables: [],
          signal: input.signal,
          stack: [...stack, input.requestId],
        });
        if (tokenExecution.status !== "succeeded") {
          throw new AuthDomainError(
            tokenExecution.error?.message ?? "Token request failed.",
            "AUTH_TOKEN_REQUEST_FAILED",
          );
        }
      },
    });
    plan = authentication.plan;
    authenticationTrace = authentication.trace;
  } catch (error) {
    return recordFailure({
      executionId: input.executionId,
      projectId: saved.projectId,
      requestId: saved.id,
      method: saved.method,
      resolvedUrl: resolution.preview.url,
      snapshot: {
        method: saved.method,
        url: resolution.preview.url,
        authentication: { error: executionError(error).message },
      },
      error,
    });
  }

  let snapshot: Record<string, unknown>;
  try {
    snapshot = {
      ...createRequestSnapshot(plan),
      authentication: authenticationTrace,
      variables: resolution.variables.map((variable) => ({
        name: variable.name,
        value: variable.preview,
        origin: variable.originLabel,
        secret: variable.secret,
      })),
    };
  } catch (error) {
    return recordFailure({
      executionId: input.executionId,
      projectId: saved.projectId,
      requestId: saved.id,
      method: saved.method,
      resolvedUrl: "[invalid URL]",
      snapshot: { method: saved.method, url: "[invalid URL]" },
      error,
    });
  }

  const resolvedUrl =
    typeof snapshot.url === "string" ? snapshot.url : safeDisplayUrl(saved.url);
  await createExecutionRecord({
    id: input.executionId,
    projectId: saved.projectId,
    requestId: saved.id,
    method: saved.method,
    resolvedUrl,
    requestSnapshot: snapshot,
  });

  try {
    const response = await executeHttpRequest(plan, input.signal);
    const outputs = await persistRequestOutputs({
      requestId: saved.id,
      executionId: input.executionId,
      rawBody: response.rawBody,
    });
    await completeExecution(
      input.executionId,
      redactExtractedOutputs(response, outputs),
    );
  } catch (error) {
    const domainError = executionError(error);
    await failExecution(
      input.executionId,
      domainError,
      domainError.code === "REQUEST_CANCELLED",
    );
  }

  return getExecutionDetail(input.executionId);
}
