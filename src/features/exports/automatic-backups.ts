import "server-only";

import { runAutomaticBackup } from "@/features/exports/backup-service";

const scheduler = globalThis as typeof globalThis & {
  workbenchBackupTimer?: NodeJS.Timeout;
  workbenchBackupRunning?: boolean;
};

async function checkForBackup() {
  if (scheduler.workbenchBackupRunning) return;
  scheduler.workbenchBackupRunning = true;
  try {
    await runAutomaticBackup();
  } catch (error) {
    console.error(
      "Automatic backup failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
  } finally {
    scheduler.workbenchBackupRunning = false;
  }
}

export function startAutomaticBackups() {
  if (scheduler.workbenchBackupTimer) return;
  const timer = setInterval(() => void checkForBackup(), 60_000);
  timer.unref();
  scheduler.workbenchBackupTimer = timer;
  void checkForBackup();
}
