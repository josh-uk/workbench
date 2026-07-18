import "server-only";

import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";

import {
  createExportArchive,
  parseExportArchive,
} from "@/features/exports/archive";
import {
  backupFilenameSchema,
  ExportDomainError,
  type ExportSecretMode,
} from "@/features/exports/domain";
import {
  collectExportScope,
  restoreExportArchive,
} from "@/features/exports/data/export-repository";
import {
  getBackupSettings,
  updateBackupStatus,
} from "@/features/exports/data/settings-repository";

export interface BackupFileSummary {
  name: string;
  sizeBytes: number;
  createdAt: string;
}

export function getBackupDirectory() {
  const configured =
    process.env.WORKBENCH_BACKUP_DIR?.trim() || "/tmp/workbench-backups";
  if (!configured.startsWith("/")) {
    throw new ExportDomainError(
      "WORKBENCH_BACKUP_DIR must be an absolute path.",
    );
  }
  return configured === "/" ? configured : configured.replace(/\/+$/, "");
}

async function ensureBackupDirectory() {
  const directory = getBackupDirectory();
  await mkdir(/* turbopackIgnore: true */ directory, {
    recursive: true,
    mode: 0o700,
  });
  await chmod(/* turbopackIgnore: true */ directory, 0o700);
  return directory;
}

function backupFilename(createdAt: Date) {
  return `workbench-backup-${createdAt.toISOString().replaceAll(":", "-").replace(".", "-")}.zip`;
}

async function backupPath(filename: string) {
  const safeName = backupFilenameSchema.parse(filename);
  const directory = await ensureBackupDirectory();
  return `${directory === "/" ? "" : directory}/${safeName}`;
}

export async function listBackups(): Promise<BackupFileSummary[]> {
  const directory = await ensureBackupDirectory();
  const entries = await readdir(/* turbopackIgnore: true */ directory, {
    withFileTypes: true,
  });
  const backups: BackupFileSummary[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !backupFilenameSchema.safeParse(entry.name).success)
      continue;
    const resolved = await backupPath(entry.name);
    const details = await lstat(/* turbopackIgnore: true */ resolved);
    if (!details.isFile() || details.isSymbolicLink()) continue;
    backups.push({
      name: entry.name,
      sizeBytes: details.size,
      createdAt: details.birthtime.toISOString(),
    });
  }
  return backups.sort((left, right) => right.name.localeCompare(left.name));
}

export async function applyBackupRetention(retentionCount: number) {
  const backups = await listBackups();
  for (const backup of backups.slice(retentionCount)) {
    await rm(/* turbopackIgnore: true */ await backupPath(backup.name));
  }
  return Math.min(backups.length, retentionCount);
}

function automaticBackupPassword(mode: ExportSecretMode, password?: string) {
  if (mode !== "encrypted") return password;
  const value = password ?? process.env.WORKBENCH_BACKUP_PASSWORD;
  if (!value || value.length < 12) {
    throw new ExportDomainError(
      "Encrypted automatic backups require WORKBENCH_BACKUP_PASSWORD with at least 12 characters.",
    );
  }
  return value;
}

export async function createBackup(input: {
  secretMode: ExportSecretMode;
  password?: string;
  retentionCount?: number;
  createdAt?: Date;
}) {
  const createdAt = input.createdAt ?? new Date();
  const scope = await collectExportScope("full", null);
  const { archive, manifest } = await createExportArchive({
    ...scope,
    kind: "full",
    secretMode: input.secretMode,
    password: automaticBackupPassword(input.secretMode, input.password),
    createdAt,
  });
  const filename = backupFilename(createdAt);
  const target = await backupPath(filename);
  const directory = await ensureBackupDirectory();
  const temporary = `${directory === "/" ? "" : directory}/.${filename}.${randomUUID()}.tmp`;
  try {
    await writeFile(/* turbopackIgnore: true */ temporary, archive, {
      flag: "wx",
      mode: 0o600,
    });
    await rename(
      /* turbopackIgnore: true */ temporary,
      /* turbopackIgnore: true */ target,
    );
    await chmod(/* turbopackIgnore: true */ target, 0o600);
  } catch (error) {
    await rm(/* turbopackIgnore: true */ temporary, { force: true });
    throw error;
  }
  const settings = await getBackupSettings();
  await applyBackupRetention(input.retentionCount ?? settings.retentionCount);
  return {
    name: filename,
    sizeBytes: archive.byteLength,
    createdAt: manifest.createdAt,
    secretMode: manifest.secretMode,
  };
}

export async function restoreBackup(input: {
  filename: string;
  password?: string;
}) {
  const target = await backupPath(input.filename);
  const details = await lstat(/* turbopackIgnore: true */ target);
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new ExportDomainError("Backup file not found.", "EXPORT_NOT_FOUND");
  }
  const archive = await readFile(/* turbopackIgnore: true */ target);
  const parsed = await parseExportArchive(archive, input.password);
  if (parsed.manifest.kind !== "full") {
    throw new ExportDomainError(
      "Only full backups can replace all application data.",
    );
  }
  return restoreExportArchive({
    ...parsed,
    targetWorkspaceId: null,
  });
}

export async function runAutomaticBackup(now = new Date()) {
  const settings = await getBackupSettings();
  if (!settings.automatic) return { ran: false as const, reason: "disabled" };
  const latest = [settings.lastAttemptAt, settings.lastSuccessAt]
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).valueOf())
    .reduce((maximum, value) => Math.max(maximum, value), 0);
  if (latest && now.valueOf() - latest < settings.intervalHours * 3_600_000) {
    return { ran: false as const, reason: "not-due" };
  }
  const attemptedAt = now.toISOString();
  try {
    const backup = await createBackup({
      secretMode: settings.secretMode,
      retentionCount: settings.retentionCount,
    });
    await updateBackupStatus({ attemptedAt, succeeded: true });
    return { ran: true as const, backup };
  } catch (error) {
    await updateBackupStatus({
      attemptedAt,
      succeeded: false,
      error:
        error instanceof ExportDomainError
          ? error.message
          : "Automatic backup failed.",
    });
    throw error;
  }
}
