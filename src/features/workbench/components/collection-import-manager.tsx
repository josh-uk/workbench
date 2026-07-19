"use client";

import {
  AlertTriangle,
  ArrowLeft,
  FileInput,
  FileUp,
  Import,
  KeyRound,
  LoaderCircle,
  ShieldCheck,
  Variable,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  executeCollectionImportAction,
  listCollectionImportsAction,
  previewCollectionImportAction,
} from "@/features/imports/actions";
import {
  MAX_COLLECTION_IMPORT_BYTES,
  type CollectionImportFormat,
  type CollectionImportPreview,
  type CollectionImportSummary,
  type CollectionConflictStrategy,
} from "@/features/imports/domain";

type Notice = (tone: "success" | "error", text: string) => void;

interface SourceState {
  sourceType: "paste" | "file";
  content: string;
  format: CollectionImportFormat | "auto";
}

const emptySource: SourceState = {
  sourceType: "paste",
  content: "",
  format: "auto",
};

const formatLabels: Record<CollectionImportFormat | "auto", string> = {
  auto: "Detect automatically",
  httpie: "HTTPie",
  postman: "Postman",
  curl: "cURL",
  raw_http: "Raw HTTP",
};

function RequestPreview({
  preview,
  selected,
  setSelected,
}: {
  preview: CollectionImportPreview;
  selected: string[];
  setSelected: (value: string[]) => void;
}) {
  const groups = useMemo(() => {
    const result = new Map<string, typeof preview.requests>();
    preview.requests.forEach((request) => {
      const path = request.folderPath.join(" / ") || "Project root";
      const items = result.get(path) ?? [];
      items.push(request);
      result.set(path, items);
    });
    return [...result.entries()];
  }, [preview]);
  if (!groups.length) {
    return (
      <div className="rounded-xl border border-dashed px-5 py-8 text-center text-xs text-muted">
        This source contains environments or variables but no supported
        requests.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {groups.map(([path, requests]) => {
        const keys = requests.map(({ sourceKey }) => sourceKey);
        const allSelected = keys.every((key) => selected.includes(key));
        return (
          <section className="overflow-hidden rounded-xl border" key={path}>
            <label className="flex items-center gap-2 border-b bg-surface-subtle px-4 py-3 text-xs font-semibold">
              <input
                checked={allSelected}
                onChange={(event) =>
                  setSelected(
                    event.target.checked
                      ? [...new Set([...selected, ...keys])]
                      : selected.filter((key) => !keys.includes(key)),
                  )
                }
                type="checkbox"
              />
              {path}
            </label>
            <div className="divide-y">
              {requests.map((request) => (
                <label
                  className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-surface-subtle"
                  key={request.sourceKey}
                >
                  <input
                    checked={selected.includes(request.sourceKey)}
                    className="mt-0.5"
                    onChange={(event) =>
                      setSelected(
                        event.target.checked
                          ? [...selected, request.sourceKey]
                          : selected.filter((key) => key !== request.sourceKey),
                      )
                    }
                    type="checkbox"
                  />
                  <span className="w-14 shrink-0 font-mono text-[0.625rem] font-bold text-accent">
                    {request.method}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">
                      {request.name}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[0.625rem] text-muted">
                      {request.url}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function CollectionImportManager({
  project,
  onClose,
  onNotice,
  onRefresh,
}: {
  project: { id: string; name: string };
  onClose: () => void;
  onNotice: Notice;
  onRefresh: () => void;
}) {
  const [imports, setImports] = useState<CollectionImportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [mode, setMode] = useState<"list" | "import">("list");
  const [source, setSource] = useState<SourceState>(emptySource);
  const [preview, setPreview] = useState<CollectionImportPreview | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [definitionName, setDefinitionName] = useState("");
  const [conflictStrategy, setConflictStrategy] =
    useState<CollectionConflictStrategy>("rename");
  const [includeEnvironments, setIncludeEnvironments] = useState(true);
  const [includeProjectVariables, setIncludeProjectVariables] = useState(true);
  const [includeAuthProfiles, setIncludeAuthProfiles] = useState(true);
  const [allowPrivateNetwork, setAllowPrivateNetwork] = useState(false);

  const loadImports = useCallback(async () => {
    const result = await listCollectionImportsAction({ projectId: project.id });
    setLoading(false);
    if (!result.ok) onNotice("error", result.error);
    else setImports(result.data);
  }, [onNotice, project.id]);

  useEffect(() => {
    let cancelled = false;
    async function loadInitialImports() {
      const result = await listCollectionImportsAction({
        projectId: project.id,
      });
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) onNotice("error", result.error);
      else setImports(result.data);
    }
    void loadInitialImports();
    return () => {
      cancelled = true;
    };
  }, [onNotice, project.id]);

  const startImport = () => {
    setSource(emptySource);
    setPreview(null);
    setSelected([]);
    setDefinitionName("");
    setConflictStrategy("rename");
    setIncludeEnvironments(true);
    setIncludeProjectVariables(true);
    setIncludeAuthProfiles(true);
    setAllowPrivateNetwork(false);
    setMode("import");
  };

  const runPreview = async () => {
    setPending(true);
    const result = await previewCollectionImportAction({
      projectId: project.id,
      source,
    });
    setPending(false);
    if (!result.ok) {
      onNotice("error", result.error);
      return;
    }
    setPreview(result.data);
    setSelected(result.data.requests.map(({ sourceKey }) => sourceKey));
    setDefinitionName(result.data.name);
    onNotice(
      "success",
      `Previewed ${result.data.requests.length} request${result.data.requests.length === 1 ? "" : "s"} from ${formatLabels[result.data.format]}.`,
    );
  };

  const runImport = async () => {
    if (!preview) return;
    setPending(true);
    const result = await executeCollectionImportAction({
      projectId: project.id,
      previewSourceHash: preview.sourceHash,
      source,
      options: {
        definitionName,
        selectedRequestKeys: selected,
        includeEnvironments,
        includeProjectVariables,
        includeAuthProfiles,
        allowPrivateNetwork,
        conflictStrategy,
      },
    });
    setPending(false);
    if (!result.ok) {
      onNotice("error", result.error);
      return;
    }
    const changed =
      result.data.createdRequests +
      result.data.replacedRequests +
      result.data.mergedRequests;
    onNotice(
      "success",
      `Imported ${changed} request${changed === 1 ? "" : "s"}.${result.data.warnings.length ? ` Review ${result.data.warnings.length} warning${result.data.warnings.length === 1 ? "" : "s"}.` : ""}`,
    );
    setMode("list");
    setPreview(null);
    await loadImports();
    onRefresh();
  };

  return (
    <main className="min-w-0 flex-1 overflow-auto bg-background p-5 sm:p-7">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-start gap-3">
          <div>
            <p className="text-[0.625rem] font-semibold tracking-[0.14em] text-muted uppercase">
              {project.name} · Portable imports
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              {mode === "import"
                ? "Import requests and configuration"
                : "Collection imports"}
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
              Preview HTTPie workspaces and commands, Postman collections, cURL
              commands, or raw HTTP before changing this project.
            </p>
          </div>
          <div className="ml-auto flex gap-2">
            {mode === "list" ? (
              <Button onClick={startImport}>
                <Import aria-hidden="true" className="size-4" /> Import source
              </Button>
            ) : (
              <Button onClick={() => setMode("list")} variant="secondary">
                <ArrowLeft aria-hidden="true" className="size-4" /> Back
              </Button>
            )}
            <Button
              aria-label="Close collection imports"
              onClick={onClose}
              size="icon"
              variant="ghost"
            >
              <X aria-hidden="true" className="size-4" />
            </Button>
          </div>
        </div>

        {mode === "list" ? (
          <section className="mt-7">
            {loading ? (
              <div className="grid place-items-center rounded-xl border py-20">
                <LoaderCircle className="size-6 animate-spin text-accent" />
              </div>
            ) : imports.length ? (
              <div className="grid gap-3 lg:grid-cols-2">
                {imports.map((item) => (
                  <article
                    className="rounded-xl border bg-surface p-5 shadow-sm"
                    key={item.id}
                  >
                    <div className="flex items-start gap-3">
                      <div className="grid size-10 place-items-center rounded-lg border bg-surface-subtle">
                        <FileInput className="size-4 text-accent" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h2 className="truncate text-sm font-semibold">
                          {item.name}
                        </h2>
                        <p className="mt-1 text-xs text-muted">
                          {formatLabels[item.format]} · {item.sourceType}
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-2 text-center">
                      <div className="rounded-lg bg-surface-subtle px-2 py-3">
                        <p className="font-mono text-lg font-semibold">
                          {item.requestCount}
                        </p>
                        <p className="text-[0.625rem] text-muted">
                          Imported items
                        </p>
                      </div>
                      <div className="rounded-lg bg-surface-subtle px-2 py-3">
                        <p className="font-mono text-lg font-semibold">
                          {item.linkedRequestCount}
                        </p>
                        <p className="text-[0.625rem] text-muted">
                          Linked requests
                        </p>
                      </div>
                    </div>
                    <p className="mt-4 text-[0.625rem] text-muted">
                      Imported {new Date(item.importedAt).toLocaleString()}
                    </p>
                  </article>
                ))}
              </div>
            ) : (
              <div className="grid place-items-center rounded-xl border border-dashed bg-surface px-6 py-20 text-center">
                <div>
                  <FileInput className="mx-auto size-8 text-muted" />
                  <h2 className="mt-4 text-sm font-semibold">
                    No collection imports
                  </h2>
                  <p className="mt-1 max-w-sm text-xs leading-5 text-muted">
                    Imported requests remain linked to their source metadata
                    without coupling the editor to that source format.
                  </p>
                  <Button className="mt-5" onClick={startImport}>
                    <Import aria-hidden="true" className="size-4" /> Import
                    source
                  </Button>
                </div>
              </div>
            )}
          </section>
        ) : !preview ? (
          <section className="mt-7 rounded-xl border bg-surface p-5 shadow-sm">
            <div className="grid gap-4 md:grid-cols-[13rem_1fr]">
              <label className="space-y-1.5 text-xs font-medium">
                Source format
                <select
                  className="h-10 w-full rounded-md border bg-surface-subtle px-3 text-xs"
                  disabled={pending}
                  onChange={(event) =>
                    setSource({
                      ...source,
                      format: event.target.value as SourceState["format"],
                    })
                  }
                  value={source.format}
                >
                  {Object.entries(formatLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex items-end gap-2">
                {(["paste", "file"] as const).map((type) => (
                  <Button
                    aria-pressed={source.sourceType === type}
                    key={type}
                    onClick={() => setSource({ ...source, sourceType: type })}
                    variant={
                      source.sourceType === type ? "default" : "secondary"
                    }
                  >
                    {type === "paste" ? (
                      <FileInput className="size-4" />
                    ) : (
                      <FileUp className="size-4" />
                    )}
                    {type === "paste" ? "Paste" : "File"}
                  </Button>
                ))}
              </div>
            </div>
            {source.sourceType === "file" ? (
              <label className="mt-5 grid cursor-pointer place-items-center rounded-xl border border-dashed bg-surface-subtle px-6 py-10 text-center text-xs text-muted hover:border-accent">
                <FileUp className="mb-3 size-6 text-accent" />
                <span className="font-medium">
                  Choose a JSON or text import
                </span>
                <span className="mt-1">Maximum size: 2 MiB</span>
                <input
                  accept=".json,.txt,.http,.curl,application/json,text/plain"
                  className="sr-only"
                  disabled={pending}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    if (file.size > MAX_COLLECTION_IMPORT_BYTES) {
                      onNotice(
                        "error",
                        "Import sources must be 2 MiB or smaller.",
                      );
                      event.target.value = "";
                      return;
                    }
                    const reader = new FileReader();
                    reader.onload = () =>
                      setSource({
                        ...source,
                        content: String(reader.result ?? ""),
                      });
                    reader.onerror = () =>
                      onNotice("error", "The import file could not be read.");
                    reader.readAsText(file);
                  }}
                  type="file"
                />
                {source.content ? (
                  <span className="mt-3 rounded-full border bg-surface px-2.5 py-1 text-foreground">
                    File loaded · {source.content.length.toLocaleString()}{" "}
                    characters
                  </span>
                ) : null}
              </label>
            ) : (
              <label className="mt-5 block space-y-1.5 text-xs font-medium">
                Import source
                <textarea
                  className="min-h-64 w-full resize-y rounded-lg border bg-code-background p-3 font-mono text-xs leading-5"
                  disabled={pending}
                  onChange={(event) =>
                    setSource({ ...source, content: event.target.value })
                  }
                  placeholder={
                    'Paste an HTTPie/Postman JSON export, cURL or HTTPie command, or raw request\n\ncurl -H "Accept: application/json" https://api.example.test/items'
                  }
                  value={source.content}
                />
              </label>
            )}
            <div className="mt-5 flex justify-end">
              <Button
                disabled={pending || !source.content.trim()}
                onClick={runPreview}
              >
                {pending ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <ShieldCheck className="size-4" />
                )}
                {pending ? "Parsing…" : "Preview import"}
              </Button>
            </div>
          </section>
        ) : (
          <div className="mt-7 space-y-5">
            <section className="rounded-xl border bg-surface p-5 shadow-sm">
              <div className="flex flex-wrap items-start gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-[0.625rem] font-semibold tracking-wider text-accent uppercase">
                    Validated {formatLabels[preview.format]}
                    {preview.formatVersion ? ` ${preview.formatVersion}` : ""}
                  </p>
                  <h2 className="mt-1 text-xl font-semibold">{preview.name}</h2>
                  <p className="mt-1 text-xs text-muted">
                    Target: {preview.target.workspaceName} /{" "}
                    {preview.target.projectName} · {preview.requests.length}{" "}
                    requests · {preview.environments.length} environments ·{" "}
                    {preview.projectVariables.length} variables
                  </p>
                </div>
                <div className="flex gap-2 text-[0.625rem] text-muted">
                  <span className="rounded-full border px-3 py-1.5">
                    <KeyRound className="mr-1 inline size-3" />
                    {preview.authProfiles.length} auth
                  </span>
                  <span className="rounded-full border px-3 py-1.5">
                    <Variable className="mr-1 inline size-3" />
                    {preview.environments.reduce(
                      (count, environment) =>
                        count + environment.variables.length,
                      preview.projectVariables.length,
                    )}{" "}
                    values
                  </span>
                </div>
              </div>
              {preview.conflicts.length ? (
                <div className="mt-4 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
                  <p className="flex items-center gap-2 font-semibold">
                    <AlertTriangle className="size-4" /> Naming conflicts
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {preview.conflicts.map((conflict) => (
                      <li key={conflict.key}>{conflict.details}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {preview.warnings.length || preview.unsupported.length ? (
                <div className="mt-4 rounded-lg border bg-surface-subtle p-3 text-xs text-muted">
                  <p className="flex items-center gap-2 font-semibold text-foreground">
                    <AlertTriangle className="size-4 text-warning" /> Import
                    warnings
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {[...preview.warnings, ...preview.unsupported].map(
                      (warning) => (
                        <li key={warning}>{warning}</li>
                      ),
                    )}
                  </ul>
                </div>
              ) : null}
            </section>

            <RequestPreview
              preview={preview}
              selected={selected}
              setSelected={setSelected}
            />

            <section className="rounded-xl border bg-surface p-5 shadow-sm">
              <h2 className="text-sm font-semibold">Import options</h2>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="space-y-1.5 text-xs font-medium">
                  Import name
                  <input
                    className="h-10 w-full rounded-md border bg-surface-subtle px-3"
                    maxLength={120}
                    onChange={(event) => setDefinitionName(event.target.value)}
                    value={definitionName}
                  />
                </label>
                <label className="space-y-1.5 text-xs font-medium">
                  Naming conflicts
                  <select
                    className="h-10 w-full rounded-md border bg-surface-subtle px-3"
                    onChange={(event) =>
                      setConflictStrategy(
                        event.target.value as CollectionConflictStrategy,
                      )
                    }
                    value={conflictStrategy}
                  >
                    <option value="rename">Import with a new name</option>
                    <option value="replace">Replace existing</option>
                    <option value="merge">Merge with existing</option>
                    <option value="skip">Skip existing</option>
                  </select>
                </label>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {[
                  [
                    "Import environments",
                    includeEnvironments,
                    setIncludeEnvironments,
                  ],
                  [
                    "Import project variables",
                    includeProjectVariables,
                    setIncludeProjectVariables,
                  ],
                  [
                    "Import authentication profiles",
                    includeAuthProfiles,
                    setIncludeAuthProfiles,
                  ],
                  [
                    "Allow private/local request targets",
                    allowPrivateNetwork,
                    setAllowPrivateNetwork,
                  ],
                ].map(([label, checked, setter]) => (
                  <label
                    className="flex items-center gap-2 rounded-lg border bg-surface-subtle p-3 text-xs"
                    key={String(label)}
                  >
                    <input
                      checked={Boolean(checked)}
                      onChange={(event) =>
                        (setter as (value: boolean) => void)(
                          event.target.checked,
                        )
                      }
                      type="checkbox"
                    />
                    {String(label)}
                  </label>
                ))}
              </div>
              <div className="mt-5 flex justify-between gap-3">
                <Button onClick={() => setPreview(null)} variant="secondary">
                  Edit source
                </Button>
                <Button
                  disabled={
                    pending ||
                    !definitionName.trim() ||
                    (!selected.length && preview.requests.length > 0)
                  }
                  onClick={runImport}
                >
                  {pending ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <Import className="size-4" />
                  )}
                  {pending
                    ? "Importing…"
                    : `Import ${selected.length} request${selected.length === 1 ? "" : "s"}`}
                </Button>
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
