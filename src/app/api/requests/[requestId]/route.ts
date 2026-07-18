import { NextResponse } from "next/server";

import { getSavedRequestDetail } from "@/features/requests/data/request-repository";
import { RequestDomainError } from "@/features/requests/domain";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ requestId: string }> },
) {
  try {
    const { requestId } = await context.params;
    return NextResponse.json(await getSavedRequestDetail(requestId));
  } catch (error) {
    const message =
      error instanceof RequestDomainError
        ? error.message
        : "Request could not be loaded.";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
