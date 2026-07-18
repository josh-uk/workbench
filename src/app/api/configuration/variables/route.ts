import { NextResponse } from "next/server";

import { getVariableConfiguration } from "@/features/variables/data/variable-repository";
import {
  variableConfigurationQuerySchema,
  VariableDomainError,
} from "@/features/variables/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const input = variableConfigurationQuerySchema.parse({
      workspaceId: url.searchParams.get("workspaceId"),
      projectId: url.searchParams.get("projectId"),
    });
    return NextResponse.json(await getVariableConfiguration(input));
  } catch (error) {
    const message =
      error instanceof VariableDomainError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Variable configuration could not be loaded.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
