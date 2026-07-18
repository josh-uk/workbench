import { z, ZodError } from "zod";

import { restoreBackup } from "@/features/exports/backup-service";
import {
  backupFilenameSchema,
  ExportDomainError,
} from "@/features/exports/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const restoreSchema = z
  .object({
    filename: backupFilenameSchema,
    password: z.string().max(512).optional(),
    confirm: z.literal("RESTORE"),
  })
  .strict();

export async function POST(request: Request) {
  try {
    const input = restoreSchema.parse(await request.json());
    const result = await restoreBackup(input);
    return Response.json({ result });
  } catch (error) {
    if (error instanceof ZodError || error instanceof ExportDomainError) {
      return Response.json(
        {
          error:
            error instanceof ZodError
              ? (error.issues[0]?.message ?? "Invalid restore request.")
              : error.message,
        },
        { status: 400 },
      );
    }
    console.error(
      "Restore failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return Response.json(
      { error: "The backup could not be restored." },
      { status: 500 },
    );
  }
}
