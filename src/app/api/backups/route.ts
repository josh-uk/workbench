import { z, ZodError } from "zod";

import { createBackup, listBackups } from "@/features/exports/backup-service";
import {
  backupSettingsSchema,
  createExportSchema,
  dataRetentionSettingsSchema,
  ExportDomainError,
} from "@/features/exports/domain";
import {
  getBackupSettings,
  getDataRetentionSettings,
  saveBackupSettings,
  saveDataRetentionSettings,
} from "@/features/exports/data/settings-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const saveSettingsSchema = z
  .object({
    backup: backupSettingsSchema.pick({
      automatic: true,
      intervalHours: true,
      retentionCount: true,
      secretMode: true,
    }),
    retention: dataRetentionSettingsSchema,
  })
  .strict();

function responseError(error: unknown) {
  if (error instanceof ZodError || error instanceof ExportDomainError) {
    return Response.json(
      {
        error:
          error instanceof ZodError
            ? (error.issues[0]?.message ?? "Invalid backup request.")
            : error.message,
      },
      { status: 400 },
    );
  }
  console.error(
    "Backup operation failed:",
    error instanceof Error ? error.message : "Unknown error",
  );
  return Response.json(
    { error: "The backup operation failed." },
    { status: 500 },
  );
}

export async function GET() {
  try {
    const [backup, retention, backups] = await Promise.all([
      getBackupSettings(),
      getDataRetentionSettings(),
      listBackups(),
    ]);
    return Response.json({
      backup,
      retention,
      backups,
      encryptedPasswordConfigured:
        (process.env.WORKBENCH_BACKUP_PASSWORD?.length ?? 0) >= 12,
    });
  } catch (error) {
    return responseError(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = createExportSchema.parse({
      ...(await request.json()),
      kind: "full",
      id: null,
    });
    const backup = await createBackup({
      secretMode: input.secretMode,
      password: input.password,
    });
    return Response.json({ backup }, { status: 201 });
  } catch (error) {
    return responseError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const input = saveSettingsSchema.parse(await request.json());
    if (
      input.backup.automatic &&
      input.backup.secretMode === "encrypted" &&
      (process.env.WORKBENCH_BACKUP_PASSWORD?.length ?? 0) < 12
    ) {
      throw new ExportDomainError(
        "Set WORKBENCH_BACKUP_PASSWORD to at least 12 characters before enabling encrypted automatic backups.",
      );
    }
    const current = await getBackupSettings();
    const [backup, retention] = await Promise.all([
      saveBackupSettings({ ...current, ...input.backup }),
      saveDataRetentionSettings(input.retention),
    ]);
    return Response.json({ backup, retention });
  } catch (error) {
    return responseError(error);
  }
}
