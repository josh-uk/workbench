import { ZodError } from "zod";

import { parseExportArchive } from "@/features/exports/archive";
import {
  ExportDomainError,
  importExportSchema,
  MAX_EXPORT_ARCHIVE_BYTES,
} from "@/features/exports/domain";
import { restoreExportArchive } from "@/features/exports/data/export-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function responseError(error: unknown) {
  if (error instanceof ZodError || error instanceof ExportDomainError) {
    return Response.json(
      {
        error:
          error instanceof ZodError
            ? (error.issues[0]?.message ?? "Invalid import request.")
            : error.message,
      },
      { status: 400 },
    );
  }
  console.error(
    "Import failed:",
    error instanceof Error ? error.message : "Unknown error",
  );
  return Response.json(
    { error: "The archive could not be imported." },
    { status: 500 },
  );
}

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_EXPORT_ARCHIVE_BYTES + 1_024 * 1_024) {
      throw new ExportDomainError("The upload is too large.");
    }
    const form = await request.formData();
    const file = form.get("archive");
    if (!(file instanceof File) || !file.size) {
      throw new ExportDomainError("Choose a Workbench ZIP archive.");
    }
    if (file.size > MAX_EXPORT_ARCHIVE_BYTES) {
      throw new ExportDomainError("The upload is too large.");
    }
    const options = importExportSchema.parse({
      targetWorkspaceId: form.get("targetWorkspaceId") || null,
      password: form.get("password") || undefined,
    });
    const parsed = await parseExportArchive(
      new Uint8Array(await file.arrayBuffer()),
      options.password,
    );
    if (
      parsed.manifest.kind === "full" &&
      form.get("confirmFullRestore") !== "RESTORE"
    ) {
      throw new ExportDomainError(
        "Type RESTORE to confirm replacing all application data.",
      );
    }
    const result = await restoreExportArchive({
      ...parsed,
      targetWorkspaceId: options.targetWorkspaceId,
    });
    return Response.json({ result });
  } catch (error) {
    return responseError(error);
  }
}
