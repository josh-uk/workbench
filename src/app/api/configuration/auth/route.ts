import { NextResponse } from "next/server";

import { getAuthConfiguration } from "@/features/authentication/data/auth-repository";
import {
  authConfigurationQuerySchema,
  AuthDomainError,
} from "@/features/authentication/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const input = authConfigurationQuerySchema.parse({
      workspaceId: url.searchParams.get("workspaceId"),
      projectId: url.searchParams.get("projectId"),
    });
    return NextResponse.json(await getAuthConfiguration(input));
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof AuthDomainError
            ? error.message
            : "Authentication configuration could not be loaded.",
      },
      { status: 400 },
    );
  }
}
