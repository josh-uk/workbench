"use client";

import {
  ArrowLeft,
  DatabaseBackup,
  Download,
  Save,
  ShieldAlert,
  Upload,
} from "lucide-react";
import { type ChangeEvent, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type {
  BackupSettings,
  DataRetentionSettings,
  ExportSecretMode,
} from "@/features/exports/domain";

interface BackupOverview {
  backup: BackupSettings;
  retention: DataRetentionSettings;
  backups: Array<{ name: string; sizeBytes: number; createdAt: string }>;
  encryptedPasswordConfigured: boolean;
}

interface BackupManagerProps {
  onClose: () => void;
  onRefresh: () => void;
  project?: { id: string; name: string };
  workspaces: Array<{ id: string; name: string }>;
  activeWorkspace: { id: string; name: string };
}

function sizeLabel(bytes: number) {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 * 1_024) return `${Math.ceil(bytes / 1_024)} KiB`;
  return `${(bytes / (1_024 * 1_024)).toFixed(1)} MiB`;
}

function downloadName(response: Response) {
  return (
    response.headers
      .get("content-disposition")
      ?.match(/filename="([^"]+)"/)?.[1] ?? "workbench-export.zip"
  );
}

async function errorMessage(response: Response) {
  try {
    const value = (await response.json()) as { error?: string };
    return value.error ?? "The operation failed.";
  } catch {
    return "The operation failed.";
  }
}

export function BackupManager({
  activeWorkspace,
  onClose,
  onRefresh,
  project,
  workspaces,
}: BackupManagerProps) {
  const [overview, setOverview] = useState<BackupOverview | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const [secretMode, setSecretMode] = useState<ExportSecretMode>("exclude");
  const [password, setPassword] = useState("");
  const [confirmPlaintext, setConfirmPlaintext] = useState(false);
  const [archive, setArchive] = useState<File | null>(null);
  const [targetWorkspaceId, setTargetWorkspaceId] = useState(
    activeWorkspace.id,
  );
  const [confirmFullRestore, setConfirmFullRestore] = useState("");
  const [selectedBackup, setSelectedBackup] = useState<string | null>(null);
  const [storedRestoreConfirmation, setStoredRestoreConfirmation] =
    useState("");

  const load = async () => {
    const response = await fetch("/api/backups", { cache: "no-store" });
    if (!response.ok) throw new Error(await errorMessage(response));
    setOverview((await response.json()) as BackupOverview);
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/backups", { cache: "no-store" });
        if (!response.ok) throw new Error(await errorMessage(response));
        const value = (await response.json()) as BackupOverview;
        if (!cancelled) setOverview(value);
      } catch (error) {
        if (!cancelled)
          setNotice({
            tone: "error",
            text:
              error instanceof Error
                ? error.message
                : "Settings failed to load.",
          });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const run = async (operation: () => Promise<string>) => {
    setPending(true);
    setNotice(null);
    try {
      setNotice({ tone: "success", text: await operation() });
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "The operation failed.",
      });
    } finally {
      setPending(false);
    }
  };

  const exportScope = (kind: "workspace" | "project", id: string) =>
    run(async () => {
      const response = await fetch("/api/exports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          id,
          secretMode,
          password: secretMode === "encrypted" ? password : undefined,
          confirmPlaintext,
        }),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = downloadName(response);
      link.click();
      URL.revokeObjectURL(url);
      return `${kind === "workspace" ? "Workspace" : "Project"} export downloaded.`;
    });

  const selectArchive = (event: ChangeEvent<HTMLInputElement>) => {
    setArchive(event.target.files?.[0] ?? null);
  };

  const importArchive = () =>
    run(async () => {
      if (!archive) throw new Error("Choose a Workbench ZIP archive.");
      const form = new FormData();
      form.set("archive", archive);
      form.set("targetWorkspaceId", targetWorkspaceId);
      if (password) form.set("password", password);
      if (confirmFullRestore)
        form.set("confirmFullRestore", confirmFullRestore);
      const response = await fetch("/api/exports/import", {
        method: "POST",
        body: form,
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      const value = (await response.json()) as {
        result: { kind: string; name: string; recordCount: number };
      };
      setArchive(null);
      setConfirmFullRestore("");
      onRefresh();
      return `Restored ${value.result.name} (${value.result.recordCount} records).`;
    });

  const saveSettings = () =>
    run(async () => {
      if (!overview) throw new Error("Settings are still loading.");
      const response = await fetch("/api/backups", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          backup: {
            automatic: overview.backup.automatic,
            intervalHours: overview.backup.intervalHours,
            retentionCount: overview.backup.retentionCount,
            secretMode: overview.backup.secretMode,
          },
          retention: overview.retention,
        }),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      await load();
      return "Backup and retention settings saved.";
    });

  const createStoredBackup = () =>
    run(async () => {
      const response = await fetch("/api/backups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secretMode,
          password: secretMode === "encrypted" ? password : undefined,
          confirmPlaintext,
        }),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      await load();
      return "Full backup created and retention applied.";
    });

  const restoreStoredBackup = () =>
    run(async () => {
      if (!selectedBackup) throw new Error("Choose a stored backup.");
      const response = await fetch("/api/backups/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: selectedBackup,
          password: password || undefined,
          confirm: storedRestoreConfirmation,
        }),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      setSelectedBackup(null);
      setStoredRestoreConfirmation("");
      await load();
      onRefresh();
      return "Full backup restored atomically.";
    });

  const updateOverview = (next: BackupOverview) => setOverview(next);

  return (
    <main className="min-w-0 flex-1 overflow-auto bg-background p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Button
              aria-label="Close settings"
              onClick={onClose}
              size="icon"
              variant="ghost"
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
            </Button>
            <div>
              <h1 className="text-lg font-semibold">
                Export, backup, and restore
              </h1>
              <p className="mt-1 text-sm text-muted">
                Versioned archives exclude secrets unless you explicitly choose
                otherwise.
              </p>
            </div>
          </div>
          <span className="rounded-md border px-2 py-1 font-mono text-[0.625rem] text-muted">
            FORMAT V1
          </span>
        </div>

        {notice ? (
          <div
            className={`rounded-lg border px-4 py-3 text-sm ${
              notice.tone === "success"
                ? "border-success/30 bg-success/10 text-success"
                : "border-red-500/30 bg-red-500/10 text-red-400"
            }`}
            role="status"
          >
            {notice.text}
          </div>
        ) : null}

        <section className="rounded-xl border bg-surface p-5">
          <div className="mb-4 flex items-start gap-3">
            <Download
              aria-hidden="true"
              className="mt-0.5 size-5 text-accent"
            />
            <div>
              <h2 className="text-sm font-semibold">Portable exports</h2>
              <p className="mt-1 text-xs leading-5 text-muted">
                Workspace and project imports create new IDs and preserve the
                source data.
              </p>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3 rounded-lg border bg-surface-subtle p-4">
              <label className="block space-y-1.5 text-xs font-medium">
                Secret handling
                <select
                  className="h-10 w-full rounded-md border bg-surface px-3 text-sm"
                  onChange={(event) =>
                    setSecretMode(event.target.value as ExportSecretMode)
                  }
                  value={secretMode}
                >
                  <option value="exclude">Exclude secrets (recommended)</option>
                  <option value="encrypted">
                    Encrypt secrets with password
                  </option>
                  <option value="plaintext">
                    Include secrets as plain text
                  </option>
                </select>
              </label>
              {secretMode === "encrypted" ? (
                <label className="block space-y-1.5 text-xs font-medium">
                  Archive password
                  <input
                    className="h-10 w-full rounded-md border bg-surface px-3 text-sm"
                    minLength={12}
                    onChange={(event) => setPassword(event.target.value)}
                    type="password"
                    value={password}
                  />
                </label>
              ) : null}
              {secretMode === "plaintext" ? (
                <label className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-5 text-amber-300">
                  <input
                    checked={confirmPlaintext}
                    className="mt-1"
                    onChange={(event) =>
                      setConfirmPlaintext(event.target.checked)
                    }
                    type="checkbox"
                  />
                  I understand this archive exposes credentials in plain text.
                </label>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={pending}
                  onClick={() => exportScope("workspace", activeWorkspace.id)}
                  size="sm"
                >
                  <Download aria-hidden="true" className="size-3.5" /> Export
                  workspace
                </Button>
                <Button
                  disabled={!project || pending}
                  onClick={() => project && exportScope("project", project.id)}
                  size="sm"
                  variant="secondary"
                >
                  Export {project?.name ?? "project"}
                </Button>
              </div>
            </div>

            <div className="space-y-3 rounded-lg border bg-surface-subtle p-4">
              <label className="block space-y-1.5 text-xs font-medium">
                Workbench ZIP archive
                <input
                  accept=".zip,application/zip"
                  className="block w-full text-xs text-muted file:mr-3 file:rounded-md file:border file:bg-surface file:px-3 file:py-2 file:text-foreground"
                  onChange={selectArchive}
                  type="file"
                />
              </label>
              <label className="block space-y-1.5 text-xs font-medium">
                Project destination
                <select
                  className="h-10 w-full rounded-md border bg-surface px-3 text-sm"
                  onChange={(event) => setTargetWorkspaceId(event.target.value)}
                  value={targetWorkspaceId}
                >
                  {workspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1.5 text-xs font-medium">
                Archive password{" "}
                <span className="font-normal text-muted">(if encrypted)</span>
                <input
                  className="h-10 w-full rounded-md border bg-surface px-3 text-sm"
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  value={password}
                />
              </label>
              <label className="block space-y-1.5 text-xs font-medium">
                Full restore confirmation{" "}
                <span className="font-normal text-muted">
                  (only for full backups)
                </span>
                <input
                  className="h-10 w-full rounded-md border bg-surface px-3 font-mono text-sm"
                  onChange={(event) =>
                    setConfirmFullRestore(event.target.value)
                  }
                  placeholder="RESTORE"
                  value={confirmFullRestore}
                />
              </label>
              <Button
                disabled={!archive || pending}
                onClick={importArchive}
                size="sm"
              >
                <Upload aria-hidden="true" className="size-3.5" /> Validate and
                import
              </Button>
            </div>
          </div>
        </section>

        <section className="rounded-xl border bg-surface p-5">
          <div className="mb-4 flex items-start gap-3">
            <DatabaseBackup
              aria-hidden="true"
              className="mt-0.5 size-5 text-accent"
            />
            <div>
              <h2 className="text-sm font-semibold">
                Automatic backups and retention
              </h2>
              <p className="mt-1 text-xs leading-5 text-muted">
                Backups are written atomically with owner-only permissions and
                pruned oldest first.
              </p>
            </div>
          </div>
          {overview ? (
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="space-y-3 rounded-lg border bg-surface-subtle p-4 lg:col-span-2">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    checked={overview.backup.automatic}
                    onChange={(event) =>
                      updateOverview({
                        ...overview,
                        backup: {
                          ...overview.backup,
                          automatic: event.target.checked,
                        },
                      })
                    }
                    type="checkbox"
                  />
                  Enable automatic backups
                </label>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="space-y-1.5 text-xs font-medium">
                    Every (hours)
                    <input
                      className="h-9 w-full rounded-md border bg-surface px-3 text-sm"
                      max={168}
                      min={1}
                      onChange={(event) =>
                        updateOverview({
                          ...overview,
                          backup: {
                            ...overview.backup,
                            intervalHours: Number(event.target.value),
                          },
                        })
                      }
                      type="number"
                      value={overview.backup.intervalHours}
                    />
                  </label>
                  <label className="space-y-1.5 text-xs font-medium">
                    Keep backups
                    <input
                      className="h-9 w-full rounded-md border bg-surface px-3 text-sm"
                      max={100}
                      min={1}
                      onChange={(event) =>
                        updateOverview({
                          ...overview,
                          backup: {
                            ...overview.backup,
                            retentionCount: Number(event.target.value),
                          },
                        })
                      }
                      type="number"
                      value={overview.backup.retentionCount}
                    />
                  </label>
                  <label className="space-y-1.5 text-xs font-medium">
                    Backup secrets
                    <select
                      className="h-9 w-full rounded-md border bg-surface px-3 text-sm"
                      onChange={(event) =>
                        updateOverview({
                          ...overview,
                          backup: {
                            ...overview.backup,
                            secretMode: event.target.value as
                              "exclude" | "encrypted",
                          },
                        })
                      }
                      value={overview.backup.secretMode}
                    >
                      <option value="exclude">Exclude</option>
                      <option value="encrypted">Encrypted</option>
                    </select>
                  </label>
                </div>
                <label className="block space-y-1.5 text-xs font-medium">
                  Executions retained per project
                  <input
                    className="h-9 w-full max-w-48 rounded-md border bg-surface px-3 text-sm"
                    max={1000}
                    min={10}
                    onChange={(event) =>
                      updateOverview({
                        ...overview,
                        retention: {
                          executionHistoryLimit: Number(event.target.value),
                        },
                      })
                    }
                    type="number"
                    value={overview.retention.executionHistoryLimit}
                  />
                </label>
                {overview.backup.secretMode === "encrypted" &&
                !overview.encryptedPasswordConfigured ? (
                  <p className="flex items-start gap-2 text-xs leading-5 text-amber-300">
                    <ShieldAlert
                      aria-hidden="true"
                      className="mt-0.5 size-4 shrink-0"
                    />
                    Set WORKBENCH_BACKUP_PASSWORD before enabling encrypted
                    automatic backups.
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button disabled={pending} onClick={saveSettings} size="sm">
                    <Save aria-hidden="true" className="size-3.5" /> Save
                    settings
                  </Button>
                  <Button
                    disabled={pending}
                    onClick={createStoredBackup}
                    size="sm"
                    variant="secondary"
                  >
                    Create backup now
                  </Button>
                </div>
              </div>
              <div className="rounded-lg border bg-surface-subtle p-4 text-xs leading-5 text-muted">
                <p className="font-medium text-foreground">Backup status</p>
                <p className="mt-2">
                  Storage: configured server backup directory
                </p>
                <p className="mt-2">
                  Last success: {overview.backup.lastSuccessAt ?? "Never"}
                </p>
                {overview.backup.lastError ? (
                  <p className="mt-2 text-red-400">
                    {overview.backup.lastError}
                  </p>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted">Loading backup settings…</p>
          )}
        </section>

        <section className="rounded-xl border bg-surface p-5">
          <h2 className="text-sm font-semibold">Stored full backups</h2>
          <p className="mt-1 text-xs leading-5 text-muted">
            Restoring replaces all application data in one database transaction.
          </p>
          <div className="mt-4 space-y-2">
            {overview?.backups.length ? (
              overview.backups.map((backup) => (
                <button
                  className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left text-xs ${
                    selectedBackup === backup.name
                      ? "border-accent bg-accent/10"
                      : "bg-surface-subtle"
                  }`}
                  key={backup.name}
                  onClick={() => setSelectedBackup(backup.name)}
                  type="button"
                >
                  <DatabaseBackup
                    aria-hidden="true"
                    className="size-4 text-accent"
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-[0.625rem]">
                    {backup.name}
                  </span>
                  <span className="text-muted">
                    {sizeLabel(backup.sizeBytes)}
                  </span>
                </button>
              ))
            ) : (
              <p className="rounded-lg border border-dashed p-4 text-xs text-muted">
                No stored backups yet.
              </p>
            )}
          </div>
          {selectedBackup ? (
            <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
              <label className="space-y-1.5 text-xs font-medium">
                Password (if encrypted)
                <input
                  className="h-9 rounded-md border bg-surface px-3 text-sm"
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  value={password}
                />
              </label>
              <label className="space-y-1.5 text-xs font-medium">
                Type RESTORE
                <input
                  className="h-9 rounded-md border bg-surface px-3 font-mono text-sm"
                  onChange={(event) =>
                    setStoredRestoreConfirmation(event.target.value)
                  }
                  value={storedRestoreConfirmation}
                />
              </label>
              <Button
                disabled={pending}
                onClick={restoreStoredBackup}
                size="sm"
                variant="destructive"
              >
                Restore selected backup
              </Button>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
