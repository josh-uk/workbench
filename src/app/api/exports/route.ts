import { ZodError } from "zod";

import {
  archiveFilename,
  createExportArchive,
} from "@/features/exports/archive";
import {
  createExportSchema,
  ExportDomainError,
} from "@/features/exports/domain";
import { collectExportScope } from "@/features/exports/data/export-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  if (error instanceof ZodError || error instanceof ExportDomainError) {
    const message =
      error instanceof ZodError
        ? (error.issues[0]?.message ?? "Invalid export request.")
        : error.message;
    return Response.json({ error: message }, { status: 400 });
  }
  console.error(
    "Export failed:",
    error instanceof Error ? error.message : "Unknown error",
  );
  return Response.json(
    { error: "The export could not be created." },
    { status: 500 },
  );
}

export async function POST(request: Request) {
  try {
    const input = createExportSchema.parse(await request.json());
    const scope = await collectExportScope(input.kind, input.id);
    const result = await createExportArchive({
      ...scope,
      kind: input.kind,
      secretMode: input.secretMode,
      password: input.password,
    });
    return new Response(result.archive, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${archiveFilename(result.manifest)}"`,
        "Content-Type": "application/zip",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
