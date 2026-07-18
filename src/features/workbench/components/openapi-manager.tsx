"use client";

import {
  AlertTriangle,
  ArrowLeft,
  Check,
  FileJson,
  FileUp,
  Globe2,
  Import,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  Server,
  ShieldCheck,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  applyOpenApiRefreshAction,
  executeOpenApiImportAction,
  listImportedDefinitionsAction,
  previewOpenApiImportAction,
  previewOpenApiRefreshAction,
} from "@/features/openapi/actions";
import {
  MAX_OPENAPI_DOCUMENT_BYTES,
  type ImportedDefinitionSummary,
  type OpenApiImportPreview,
  type OpenApiRefreshPreview,
  type OpenApiSourceType,
} from "@/features/openapi/domain";
import { cn } from "@/lib/utils";

type Notice = (tone: "success" | "error", text: string) => void;

interface SourceState {
  sourceType: OpenApiSourceType;
  content: string;
  sourceUrl: string;
  allowPrivateNetwork: boolean;
}

const emptySource: SourceState = {
  sourceType: "paste",
  content: "",
  sourceUrl: "",
  allowPrivateNetwork: false,
};

function SourceEditor({
  source,
  setSource,
  disabled,
  onError,
}: {
  source: SourceState;
  setSource: (value: SourceState) => void;
  disabled: boolean;
  onError: (message: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {(
          [
            ["paste", FileJson, "Paste JSON or YAML"],
            ["file", FileUp, "Upload a local file"],
            ["url", Globe2, "Import from URL"],
          ] as const
        ).map(([type, Icon, label]) => (
          <button
            aria-pressed={source.sourceType === type}
            className={cn(
              "flex items-center gap-3 rounded-lg border p-3 text-left text-xs",
              source.sourceType === type
                ? "border-accent bg-accent/10 text-foreground"
                : "bg-surface-subtle text-muted hover:text-foreground",
            )}
            disabled={disabled}
            key={type}
            onClick={() => setSource({ ...source, sourceType: type })}
            type="button"
          >
            <Icon aria-hidden="true" className="size-4 shrink-0" />
            {label}
          </button>
        ))}
      </div>

      {source.sourceType === "url" ? (
        <div>
          <label className="block space-y-1.5 text-xs font-medium">
            OpenAPI source URL
            <input
              className="h-10 w-full rounded-md border bg-surface-subtle px-3 font-mono text-xs"
              disabled={disabled}
              onChange={(event) =>
                setSource({ ...source, sourceUrl: event.target.value })
              }
              placeholder="https://api.example.test/openapi.yaml"
              type="url"
              value={source.sourceUrl}
            />
          </label>
        </div>
      ) : source.sourceType === "file" ? (
        <label className="grid cursor-pointer place-items-center rounded-xl border border-dashed bg-surface-subtle px-6 py-10 text-center text-xs text-muted hover:border-accent hover:text-foreground">
          <FileUp aria-hidden="true" className="mb-3 size-6 text-accent" />
          <span className="font-medium">
            Choose an OpenAPI JSON or YAML file
          </span>
          <span className="mt-1">Maximum size: 2 MiB</span>
          <input
            accept=".json,.yaml,.yml,application/json,application/yaml,text/yaml"
            className="sr-only"
            disabled={disabled}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              if (file.size > MAX_OPENAPI_DOCUMENT_BYTES) {
                onError("OpenAPI documents must be 2 MiB or smaller.");
                event.target.value = "";
                return;
              }
              const reader = new FileReader();
              reader.onload = () =>
                setSource({ ...source, content: String(reader.result ?? "") });
              reader.onerror = () =>
                onError("The OpenAPI file could not be read.");
              reader.readAsText(file);
            }}
            type="file"
          />
          {source.content ? (
            <span className="mt-3 rounded-full border bg-surface px-2.5 py-1 text-foreground">
              File loaded · {source.content.length.toLocaleString()} characters
            </span>
          ) : null}
        </label>
      ) : (
        <label className="block space-y-1.5 text-xs font-medium">
          OpenAPI JSON or YAML
          <textarea
            className="min-h-64 w-full resize-y rounded-lg border bg-code-background p-3 font-mono text-xs leading-5"
            disabled={disabled}
            onChange={(event) =>
              setSource({ ...source, content: event.target.value })
            }
            placeholder={
              "openapi: 3.1.0\ninfo:\n  title: Example API\n  version: 1.0.0"
            }
            value={source.content}
          />
        </label>
      )}

      <label className="flex items-start gap-2 rounded-lg border bg-surface-subtle p-3 text-xs text-muted">
        <input
          aria-label="Allow trusted private/local network"
          checked={source.allowPrivateNetwork}
          className="mt-0.5"
          disabled={disabled}
          onChange={(event) =>
            setSource({
              ...source,
              allowPrivateNetwork: event.target.checked,
            })
          }
          type="checkbox"
        />
        <span>
          Allow trusted private/local network access for this source and its
          generated requests. Cloud metadata addresses, non-HTTP protocols,
          credentials in URLs, oversized responses, and unsafe redirects remain
          blocked.
        </span>
      </label>
    </div>
  );
}

function OperationPreview({
  preview,
  selected,
  setSelected,
  tagFolders,
  setTagFolders,
}: {
  preview: OpenApiImportPreview;
  selected: string[];
  setSelected: (value: string[]) => void;
  tagFolders: Record<string, string>;
  setTagFolders: (value: Record<string, string>) => void;
}) {
  const groups = useMemo(() => {
    const result = new Map<string, typeof preview.operations>();
    for (const operation of preview.operations) {
      const items = result.get(operation.primaryTag) ?? [];
      items.push(operation);
      result.set(operation.primaryTag, items);
    }
    return [...result.entries()];
  }, [preview]);

  return (
    <div className="space-y-4">
      {groups.map(([tag, operations]) => {
        const keys = operations.map(({ sourceKey }) => sourceKey);
        const allSelected = keys.every((key) => selected.includes(key));
        return (
          <section className="overflow-hidden rounded-xl border" key={tag}>
            <div className="flex flex-wrap items-center gap-3 border-b bg-surface-subtle px-4 py-3">
              <label className="flex items-center gap-2 text-xs font-semibold">
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
                {tag}
              </label>
              <label className="ml-auto flex items-center gap-2 text-[11px] text-muted">
                Folder
                <input
                  aria-label={`Folder for ${tag}`}
                  className="h-8 w-48 rounded-md border bg-surface px-2 text-xs text-foreground"
                  maxLength={120}
                  onChange={(event) =>
                    setTagFolders({
                      ...tagFolders,
                      [tag]: event.target.value,
                    })
                  }
                  value={tagFolders[tag] ?? tag}
                />
              </label>
            </div>
            <div className="divide-y">
              {operations.map((operation) => (
                <label
                  className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-surface-subtle"
                  key={operation.sourceKey}
                >
                  <input
                    checked={selected.includes(operation.sourceKey)}
                    className="mt-0.5"
                    onChange={(event) =>
                      setSelected(
                        event.target.checked
                          ? [...selected, operation.sourceKey]
                          : selected.filter(
                              (key) => key !== operation.sourceKey,
                            ),
                      )
                    }
                    type="checkbox"
                  />
                  <span className="w-14 shrink-0 font-mono text-[10px] font-bold text-accent">
                    {operation.method}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-xs">
                      {operation.path}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-muted">
                      {operation.name}
                      {operation.deprecated ? " · deprecated" : ""}
                    </span>
                    {operation.conflict ? (
                      <span className="mt-1 block text-[10px] text-warning">
                        {operation.conflict}
                      </span>
                    ) : null}
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

export function OpenApiManager({
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
  const [definitions, setDefinitions] = useState<ImportedDefinitionSummary[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [mode, setMode] = useState<"list" | "import" | "refresh">("list");
  const [source, setSource] = useState<SourceState>(emptySource);
  const [preview, setPreview] = useState<OpenApiImportPreview | null>(null);
  const [refreshPreview, setRefreshPreview] =
    useState<OpenApiRefreshPreview | null>(null);
  const [refreshDefinition, setRefreshDefinition] =
    useState<ImportedDefinitionSummary | null>(null);
  const [selectedOperations, setSelectedOperations] = useState<string[]>([]);
  const [selectedChanges, setSelectedChanges] = useState<string[]>([]);
  const [tagFolders, setTagFolders] = useState<Record<string, string>>({});
  const [definitionName, setDefinitionName] = useState("");
  const [createServerVariable, setCreateServerVariable] = useState(true);
  const [serverVariableName, setServerVariableName] = useState("baseUrl");
  const [createAuthProfiles, setCreateAuthProfiles] = useState(true);
  const [conflictStrategy, setConflictStrategy] = useState<
    "rename" | "replace" | "skip"
  >("rename");

  const loadDefinitions = useCallback(async () => {
    const result = await listImportedDefinitionsAction({
      projectId: project.id,
    });
    setLoading(false);
    if (!result.ok) {
      onNotice("error", result.error);
      return;
    }
    setDefinitions(result.data);
  }, [onNotice, project.id]);

  useEffect(() => {
    let cancelled = false;
    async function loadInitialDefinitions() {
      const result = await listImportedDefinitionsAction({
        projectId: project.id,
      });
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        onNotice("error", result.error);
        return;
      }
      setDefinitions(result.data);
    }
    void loadInitialDefinitions();
    return () => {
      cancelled = true;
    };
  }, [onNotice, project.id]);

  const sourceInput = (content?: string) => ({
    sourceType: source.sourceType,
    content:
      content ?? (source.sourceType === "url" ? undefined : source.content),
    sourceUrl: source.sourceType === "url" ? source.sourceUrl : undefined,
    allowPrivateNetwork: source.allowPrivateNetwork,
  });

  const resetEditor = () => {
    setPreview(null);
    setRefreshPreview(null);
    setSelectedOperations([]);
    setSelectedChanges([]);
    setTagFolders({});
  };

  const startImport = () => {
    resetEditor();
    setSource(emptySource);
    setDefinitionName("");
    setMode("import");
  };

  const startRefresh = (definition: ImportedDefinitionSummary) => {
    resetEditor();
    setRefreshDefinition(definition);
    setSource({
      ...emptySource,
      sourceType: definition.sourceType,
      sourceUrl: definition.sourceUrl ?? "",
      allowPrivateNetwork: definition.allowPrivateNetwork,
    });
    setMode("refresh");
  };

  const runImportPreview = async () => {
    setPending(true);
    const result = await previewOpenApiImportAction({
      projectId: project.id,
      source: sourceInput(),
    });
    setPending(false);
    if (!result.ok) {
      onNotice("error", result.error);
      return;
    }
    setPreview(result.data);
    setDefinitionName(result.data.title);
    setSelectedOperations(
      result.data.operations.map(({ sourceKey }) => sourceKey),
    );
    setTagFolders(
      Object.fromEntries(
        result.data.operations.map(({ primaryTag }) => [
          primaryTag,
          primaryTag,
        ]),
      ),
    );
    onNotice(
      "success",
      `Previewed ${result.data.operations.length} OpenAPI operations.`,
    );
  };

  const importDefinition = async () => {
    if (!preview) return;
    setPending(true);
    const result = await executeOpenApiImportAction({
      projectId: project.id,
      source: sourceInput(preview.originalDocument),
      options: {
        name: definitionName,
        selectedOperationKeys: selectedOperations,
        tagFolders,
        createServerVariable,
        serverVariableName,
        createAuthProfiles,
        conflictStrategy,
      },
    });
    setPending(false);
    if (!result.ok) {
      onNotice("error", result.error);
      return;
    }
    onNotice(
      "success",
      `Imported ${result.data.createdRequests + result.data.replacedRequests} requests from ${definitionName}.${result.data.warnings.length ? ` Review ${result.data.warnings.length} import warning${result.data.warnings.length === 1 ? "" : "s"}.` : ""}`,
    );
    setMode("list");
    resetEditor();
    await loadDefinitions();
    onRefresh();
  };

  const runRefreshPreview = async () => {
    if (!refreshDefinition) return;
    setPending(true);
    const result = await previewOpenApiRefreshAction({
      definitionId: refreshDefinition.id,
      source: sourceInput(),
    });
    setPending(false);
    if (!result.ok) {
      onNotice("error", result.error);
      return;
    }
    setRefreshPreview(result.data);
    setSelectedChanges(
      result.data.changes
        .filter((change) => !change.customized)
        .map(({ key }) => key),
    );
    onNotice(
      "success",
      result.data.changes.length
        ? `Found ${result.data.changes.length} refresh changes.`
        : "The imported definition is already current.",
    );
  };

  const applyRefresh = async () => {
    if (!refreshDefinition || !refreshPreview) return;
    setPending(true);
    const result = await applyOpenApiRefreshAction({
      definitionId: refreshDefinition.id,
      source: sourceInput(refreshPreview.source.originalDocument),
      selectedChangeKeys: selectedChanges,
    });
    setPending(false);
    if (!result.ok) {
      onNotice("error", result.error);
      return;
    }
    onNotice(
      "success",
      `Refresh applied: ${result.data.added} added, ${result.data.updated} updated, ${result.data.removed} removed.${result.data.warnings.length ? ` ${result.data.warnings.length} warning${result.data.warnings.length === 1 ? "" : "s"}; customized data was preserved.` : ""}`,
    );
    setMode("list");
    resetEditor();
    await loadDefinitions();
    onRefresh();
  };

  return (
    <main className="min-w-0 flex-1 overflow-auto bg-background p-5 sm:p-7">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-start gap-3">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.14em] text-muted uppercase">
              {project.name} · OpenAPI
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              {mode === "import"
                ? "Import an OpenAPI definition"
                : mode === "refresh"
                  ? `Refresh ${refreshDefinition?.name ?? "definition"}`
                  : "Imported definitions"}
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
              Preview OpenAPI 3.x JSON or YAML before creating folders,
              authentication profiles, variables, and executable requests.
            </p>
          </div>
          <div className="ml-auto flex gap-2">
            {mode === "list" ? (
              <Button onClick={startImport}>
                <Import aria-hidden="true" className="size-4" /> Import OpenAPI
              </Button>
            ) : (
              <Button
                onClick={() => {
                  setMode("list");
                  resetEditor();
                }}
                variant="secondary"
              >
                <ArrowLeft aria-hidden="true" className="size-4" /> Back
              </Button>
            )}
            <Button
              aria-label="Close imports"
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
            ) : definitions.length ? (
              <div className="grid gap-3 lg:grid-cols-2">
                {definitions.map((definition) => (
                  <article
                    className="rounded-xl border bg-surface p-5 shadow-sm"
                    key={definition.id}
                  >
                    <div className="flex items-start gap-3">
                      <div className="grid size-10 shrink-0 place-items-center rounded-lg border bg-surface-subtle">
                        <FileJson
                          aria-hidden="true"
                          className="size-4 text-accent"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h2 className="truncate text-sm font-semibold">
                          {definition.name}
                        </h2>
                        <p className="mt-1 text-xs text-muted">
                          OpenAPI {definition.openapiVersion ?? "3.x"}
                          {definition.apiVersion
                            ? ` · API ${definition.apiVersion}`
                            : ""}
                        </p>
                      </div>
                      <Button
                        onClick={() => startRefresh(definition)}
                        size="sm"
                        variant="secondary"
                      >
                        <RefreshCw aria-hidden="true" className="size-3.5" />{" "}
                        Refresh
                      </Button>
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                      {[
                        ["Operations", definition.operationCount],
                        ["Requests", definition.linkedRequestCount],
                        ["Customized", definition.customizedRequestCount],
                      ].map(([label, value]) => (
                        <div
                          className="rounded-lg bg-surface-subtle px-2 py-3"
                          key={label}
                        >
                          <p className="font-mono text-lg font-semibold">
                            {value}
                          </p>
                          <p className="text-[10px] text-muted">{label}</p>
                        </div>
                      ))}
                    </div>
                    <p className="mt-4 truncate font-mono text-[10px] text-muted">
                      {definition.sourceUrl ??
                        `${definition.sourceType} source`}{" "}
                      · updated{" "}
                      {new Date(definition.updatedAt).toLocaleString()}
                    </p>
                  </article>
                ))}
              </div>
            ) : (
              <div className="grid place-items-center rounded-xl border border-dashed bg-surface px-6 py-20 text-center">
                <div>
                  <FileJson className="mx-auto size-8 text-muted" />
                  <h2 className="mt-4 text-sm font-semibold">
                    No imported definitions
                  </h2>
                  <p className="mt-1 max-w-sm text-xs leading-5 text-muted">
                    Importing preserves the source document and operation
                    metadata so future refreshes can be reviewed selectively.
                  </p>
                  <Button className="mt-5" onClick={startImport}>
                    <Import aria-hidden="true" className="size-4" /> Import
                    OpenAPI
                  </Button>
                </div>
              </div>
            )}
          </section>
        ) : mode === "import" ? (
          <div className="mt-7 space-y-5">
            {!preview ? (
              <section className="rounded-xl border bg-surface p-5 shadow-sm">
                <SourceEditor
                  disabled={pending}
                  onError={(message) => onNotice("error", message)}
                  setSource={setSource}
                  source={source}
                />
                <div className="mt-5 flex justify-end">
                  <Button disabled={pending} onClick={runImportPreview}>
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
              <>
                <section className="rounded-xl border bg-surface p-5 shadow-sm">
                  <div className="flex flex-wrap items-start gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-semibold tracking-wider text-accent uppercase">
                        Validated OpenAPI {preview.openapiVersion}
                      </p>
                      <h2 className="mt-1 text-xl font-semibold">
                        {preview.title}
                      </h2>
                      <p className="mt-1 text-xs text-muted">
                        API version {preview.apiVersion ?? "not declared"} ·{" "}
                        {preview.operations.length} operations ·{" "}
                        {preview.tags.length ||
                          new Set(
                            preview.operations.map(
                              ({ primaryTag }) => primaryTag,
                            ),
                          ).size}{" "}
                        tags
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <span className="flex items-center gap-1.5 rounded-full border bg-surface-subtle px-3 py-1.5 text-[10px] text-muted">
                        <Server className="size-3" /> {preview.servers.length}{" "}
                        servers
                      </span>
                      <span className="flex items-center gap-1.5 rounded-full border bg-surface-subtle px-3 py-1.5 text-[10px] text-muted">
                        <KeyRound className="size-3" />{" "}
                        {
                          preview.securityProposals.filter(
                            ({ supported }) => supported,
                          ).length
                        }{" "}
                        auth schemes
                      </span>
                    </div>
                  </div>
                  {preview.conflicts.length ? (
                    <div className="mt-4 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
                      <div className="flex items-center gap-2 font-semibold">
                        <AlertTriangle className="size-4" /> Conflicts to review
                      </div>
                      <ul className="mt-2 list-disc space-y-1 pl-5">
                        {preview.conflicts.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {preview.warnings.length ? (
                    <div className="mt-4 rounded-lg border bg-surface-subtle p-3 text-xs text-muted">
                      <div className="flex items-center gap-2 font-semibold text-foreground">
                        <AlertTriangle className="size-4 text-warning" /> Parser
                        warnings
                      </div>
                      <ul className="mt-2 list-disc space-y-1 pl-5">
                        {preview.warnings.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {preview.servers.length ||
                  preview.securityProposals.length ? (
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <div className="rounded-lg border bg-surface-subtle p-3">
                        <p className="flex items-center gap-2 text-xs font-semibold">
                          <Server className="size-3.5 text-accent" /> Servers
                        </p>
                        <div className="mt-2 space-y-1.5">
                          {preview.servers.length ? (
                            preview.servers.map((server) => (
                              <p
                                className="truncate font-mono text-[10px] text-muted"
                                key={server.url}
                                title={server.resolvedUrl}
                              >
                                {server.resolvedUrl}
                              </p>
                            ))
                          ) : (
                            <p className="text-[10px] text-muted">
                              Placeholder server used
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="rounded-lg border bg-surface-subtle p-3">
                        <p className="flex items-center gap-2 text-xs font-semibold">
                          <KeyRound className="size-3.5 text-accent" /> Security
                          mapping
                        </p>
                        <div className="mt-2 space-y-1.5">
                          {preview.securityProposals.length ? (
                            preview.securityProposals.map((proposal) => (
                              <p
                                className="flex items-center justify-between gap-2 text-[10px]"
                                key={proposal.schemeName}
                              >
                                <span className="truncate">
                                  {proposal.name}
                                </span>
                                <span
                                  className={cn(
                                    "shrink-0 font-mono",
                                    proposal.supported
                                      ? "text-success"
                                      : "text-warning",
                                  )}
                                >
                                  {proposal.supported
                                    ? proposal.type.replaceAll("_", " ")
                                    : "unsupported"}
                                </span>
                              </p>
                            ))
                          ) : (
                            <p className="text-[10px] text-muted">
                              No security schemes
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </section>

                <section className="rounded-xl border bg-surface p-5 shadow-sm">
                  <h2 className="text-sm font-semibold">Import plan</h2>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <label className="space-y-1.5 text-xs font-medium">
                      Definition name
                      <input
                        className="h-9 w-full rounded-md border bg-surface-subtle px-2.5"
                        onChange={(event) =>
                          setDefinitionName(event.target.value)
                        }
                        value={definitionName}
                      />
                    </label>
                    <label className="space-y-1.5 text-xs font-medium">
                      Request conflicts
                      <select
                        className="h-9 w-full rounded-md border bg-surface-subtle px-2.5"
                        onChange={(event) =>
                          setConflictStrategy(
                            event.target.value as typeof conflictStrategy,
                          )
                        }
                        value={conflictStrategy}
                      >
                        <option value="rename">Rename generated request</option>
                        <option value="replace">Replace after review</option>
                        <option value="skip">Skip conflicting request</option>
                      </select>
                    </label>
                    <label className="flex items-start gap-2 rounded-lg border bg-surface-subtle p-3 text-xs">
                      <input
                        checked={createServerVariable}
                        className="mt-0.5"
                        onChange={(event) =>
                          setCreateServerVariable(event.target.checked)
                        }
                        type="checkbox"
                      />
                      <span className="flex-1">
                        Create a project variable for the first server URL
                        <input
                          aria-label="Server variable name"
                          className="mt-2 h-8 w-full rounded-md border bg-surface px-2 font-mono text-xs"
                          disabled={!createServerVariable}
                          onChange={(event) =>
                            setServerVariableName(event.target.value)
                          }
                          value={serverVariableName}
                        />
                      </span>
                    </label>
                    <label className="flex items-start gap-2 rounded-lg border bg-surface-subtle p-3 text-xs">
                      <input
                        checked={createAuthProfiles}
                        className="mt-0.5"
                        onChange={(event) =>
                          setCreateAuthProfiles(event.target.checked)
                        }
                        type="checkbox"
                      />
                      <span>
                        Create authentication profiles for supported security
                        schemes. Credentials remain empty until configured.
                      </span>
                    </label>
                  </div>
                </section>

                <OperationPreview
                  preview={preview}
                  selected={selectedOperations}
                  setSelected={setSelectedOperations}
                  setTagFolders={setTagFolders}
                  tagFolders={tagFolders}
                />

                <div className="sticky bottom-3 flex items-center justify-between rounded-xl border bg-surface/95 p-3 shadow-xl backdrop-blur">
                  <span className="text-xs text-muted">
                    {selectedOperations.length} of {preview.operations.length}{" "}
                    operations selected
                  </span>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => setPreview(null)}
                      variant="secondary"
                    >
                      Change source
                    </Button>
                    <Button
                      disabled={pending || !selectedOperations.length}
                      onClick={importDefinition}
                    >
                      {pending ? (
                        <LoaderCircle className="size-4 animate-spin" />
                      ) : (
                        <Check className="size-4" />
                      )}
                      {pending ? "Importing…" : "Apply import"}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="mt-7 space-y-5">
            {!refreshPreview ? (
              <section className="rounded-xl border bg-surface p-5 shadow-sm">
                <SourceEditor
                  disabled={pending}
                  onError={(message) => onNotice("error", message)}
                  setSource={setSource}
                  source={source}
                />
                <div className="mt-5 flex justify-end">
                  <Button disabled={pending} onClick={runRefreshPreview}>
                    {pending ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : (
                      <RefreshCw className="size-4" />
                    )}
                    {pending ? "Comparing…" : "Preview refresh"}
                  </Button>
                </div>
              </section>
            ) : (
              <>
                <section className="rounded-xl border bg-surface p-5 shadow-sm">
                  <h2 className="text-sm font-semibold">Refresh diff</h2>
                  <p className="mt-1 text-xs text-muted">
                    {refreshPreview.changes.length} changes ·{" "}
                    {refreshPreview.unchangedOperationCount} unchanged
                    operations. Customized requests are unselected by default
                    and will never be overwritten.
                  </p>
                </section>
                <section className="overflow-hidden rounded-xl border bg-surface shadow-sm">
                  {refreshPreview.changes.length ? (
                    <div className="divide-y">
                      {refreshPreview.changes.map((change) => (
                        <label
                          className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-surface-subtle"
                          key={change.key}
                        >
                          <input
                            checked={selectedChanges.includes(change.key)}
                            className="mt-0.5"
                            onChange={(event) =>
                              setSelectedChanges(
                                event.target.checked
                                  ? [...selectedChanges, change.key]
                                  : selectedChanges.filter(
                                      (key) => key !== change.key,
                                    ),
                              )
                            }
                            type="checkbox"
                          />
                          <span
                            className={cn(
                              "w-28 shrink-0 rounded-full border px-2 py-1 text-center text-[9px] font-semibold uppercase",
                              change.category === "added"
                                ? "border-success/30 text-success"
                                : change.category === "removed"
                                  ? "border-red-500/30 text-red-400"
                                  : "border-warning/30 text-warning",
                            )}
                          >
                            {change.category.replaceAll("_", " ")}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block font-mono text-xs">
                              {change.label}
                            </span>
                            <span className="mt-1 block text-[11px] text-muted">
                              {change.details.join(" · ")}
                            </span>
                            {change.customized ? (
                              <span className="mt-1 block text-[10px] text-warning">
                                Customized request will be preserved
                              </span>
                            ) : null}
                          </span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <div className="grid place-items-center px-6 py-16 text-center">
                      <Check className="size-7 text-success" />
                      <p className="mt-3 text-sm font-medium">
                        No changes found
                      </p>
                    </div>
                  )}
                </section>
                <div className="sticky bottom-3 flex items-center justify-between rounded-xl border bg-surface/95 p-3 shadow-xl backdrop-blur">
                  <span className="text-xs text-muted">
                    {selectedChanges.length} changes selected
                  </span>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => setRefreshPreview(null)}
                      variant="secondary"
                    >
                      Change source
                    </Button>
                    <Button
                      disabled={pending || !selectedChanges.length}
                      onClick={applyRefresh}
                    >
                      {pending ? (
                        <LoaderCircle className="size-4 animate-spin" />
                      ) : (
                        <Check className="size-4" />
                      )}
                      {pending ? "Applying…" : "Apply selected changes"}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
