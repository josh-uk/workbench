import { NextResponse } from "next/server";

import { cancelExecution } from "@/features/requests/execution/active-executions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ executionId: string }> },
) {
  const { executionId } = await context.params;
  const cancelled = cancelExecution(executionId);
  return NextResponse.json({ cancelled }, { status: cancelled ? 202 : 404 });
}
