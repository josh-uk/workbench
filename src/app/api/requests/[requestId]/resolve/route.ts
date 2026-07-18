import { NextResponse } from "next/server";

import { getSavedRequestDetail } from "@/features/requests/data/request-repository";
import { resolveSavedRequestSchema } from "@/features/requests/domain";
import { getVariableDefinitionsForRequest } from "@/features/variables/data/variable-repository";
import { VariableDomainError } from "@/features/variables/domain";
import { resolveRequestPlan } from "@/features/variables/resolution";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ requestId: string }> },
) {
  try {
    const { requestId } = await context.params;
    const input = resolveSavedRequestSchema.parse(await request.json());
    const saved = await getSavedRequestDetail(requestId);
    const definitions = await getVariableDefinitionsForRequest({
      requestId,
      workspaceEnvironmentId: saved.settings.workspaceEnvironmentId,
      projectEnvironmentId: saved.settings.projectEnvironmentId,
      runtimeVariables: input.runtimeVariables,
    });
    const resolution = resolveRequestPlan(
      {
        id: saved.id,
        projectId: saved.projectId,
        method: saved.method,
        url: saved.url,
        queryParameters: saved.queryParameters,
        headers: saved.headers,
        body: saved.body,
        settings: saved.settings,
      },
      definitions,
    );
    return NextResponse.json({
      preview: resolution.preview,
      variables: resolution.variables.map((variable) => ({
        name: variable.name,
        preview: variable.preview,
        secret: variable.secret,
        origin: variable.origin,
        originLabel: variable.originLabel,
        unresolved: variable.unresolved,
        errors: variable.errors,
      })),
      unresolved: resolution.unresolved,
      errors: resolution.errors,
    });
  } catch (error) {
    const message =
      error instanceof VariableDomainError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Request variables could not be resolved.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
