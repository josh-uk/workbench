import "server-only";

import { eq } from "drizzle-orm";

import { getDatabase } from "@/db/client";
import { applicationSettings } from "@/db/schema";
import {
  backupSettingsSchema,
  type BackupSettings,
  dataRetentionSettingsSchema,
  type DataRetentionSettings,
} from "@/features/exports/domain";

const BACKUP_SETTINGS_KEY = "backup.configuration";
const RETENTION_SETTINGS_KEY = "retention.configuration";

async function getValue(key: string) {
  const [setting] = await getDatabase()
    .select({ value: applicationSettings.value })
    .from(applicationSettings)
    .where(eq(applicationSettings.key, key))
    .limit(1);
  return setting?.value;
}

async function saveValue(key: string, value: unknown) {
  await getDatabase()
    .insert(applicationSettings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: applicationSettings.key,
      set: { value, updatedAt: new Date() },
    });
}

export async function getBackupSettings(): Promise<BackupSettings> {
  return backupSettingsSchema.parse(
    (await getValue(BACKUP_SETTINGS_KEY)) ?? {},
  );
}

export async function saveBackupSettings(value: unknown) {
  const settings = backupSettingsSchema.parse(value);
  await saveValue(BACKUP_SETTINGS_KEY, settings);
  return settings;
}

export async function updateBackupStatus(input: {
  attemptedAt: string;
  succeeded: boolean;
  error?: string;
}) {
  const current = await getBackupSettings();
  return saveBackupSettings({
    ...current,
    lastAttemptAt: input.attemptedAt,
    lastSuccessAt: input.succeeded ? input.attemptedAt : current.lastSuccessAt,
    lastError: input.succeeded ? null : (input.error ?? "Backup failed."),
  });
}

export async function getDataRetentionSettings(): Promise<DataRetentionSettings> {
  return dataRetentionSettingsSchema.parse(
    (await getValue(RETENTION_SETTINGS_KEY)) ?? {},
  );
}

export async function saveDataRetentionSettings(value: unknown) {
  const settings = dataRetentionSettingsSchema.parse(value);
  await saveValue(RETENTION_SETTINGS_KEY, settings);
  return settings;
}
