"use client";

import {
  AlertTriangle,
  Braces,
  Copy,
  FileUp,
  KeyRound,
  LoaderCircle,
  Plus,
  Save,
  Send,
  Square,
  Trash2,
  Unlink,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { detachImportedRequestAction } from "@/features/openapi/actions";
import {
  duplicateSavedRequestAction,
  updateSavedRequestAction,
} from "@/features/requests/actions";
import {
  type ExecutionDetail,
  httpMethods,
  type RequestField,
  requestBodyTypes,
  type SavedRequestDetail,
} from "@/features/requests/domain";
import type { FolderNode } from "@/features/workspaces/domain";
import type {
  ResolvedVariable,
  VariableResolutionError,
  VariableValue,
} from "@/features/variables/domain";
import type { RequestResolutionPreview } from "@/features/variables/resolution";
import { cn } from "@/lib/utils";

import { RequestFieldEditor } from "./request-field-editor";
import { AssertionEditor } from "./assertion-editor";
import { ResponseViewer } from "./response-viewer";
import { VariableRowsEditor } from "./variable-rows-editor";

const requestTabs = [
  "Params",
  "Headers",
  "Cookies",
  "Auth",
  "Variables",
  "Body",
  "Outputs",
  "Tests",
  "Settings",
] as const;

function draftSignature(detail: SavedRequestDetail) {
  return JSON.stringify(normaliseDraft(detail));
}

function flattenFolders(folders: FolderNode[]) {
  const result: Array<{ id: string; name: string; depth: number }> = [];
  const walk = (nodes: FolderNode[], depth: number) => {
    for (const node of nodes) {
      result.push({ id: node.id, name: node.name, depth });
      walk(node.children, depth + 1);
    }
  };
  walk(folders, 0);
  return result;
}

function normaliseDraft(detail: SavedRequestDetail) {
  return {
    id: detail.id,
    authProfileId: detail.authProfileId,
    name: detail.name,
    description: detail.description ?? "",
    method: detail.method,
    url: detail.url,
    folderId: detail.folderId,
    tags: detail.tags,
    queryParameters: detail.queryParameters.map((field) => ({
      name: field.name,
      value: field.value,
      enabled: field.enabled,
    })),
    headers: detail.headers,
    requestVariables: detail.requestVariables,
    outputDefinitions: detail.outputDefinitions,
    assertions: detail.assertions,
    body: detail.body,
    settings: detail.settings,
  };
}

export function RequestEditor({
  folders,
  onDelete,
  onNotice,
  onRefresh,
  onSelectRequest,
  requestId,
}: {
  folders: FolderNode[];
  onDelete: (request: { id: string; name: string }) => void;
  onNotice: (tone: "success" | "error", text: string) => void;
  onRefresh: () => void;
  onSelectRequest: (id: string) => void;
  requestId: string;
}) {
  const [detail, setDetail] = useState<SavedRequestDetail | null>(null);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [tab, setTab] = useState<(typeof requestTabs)[number]>("Params");
  const [saving, setSaving] = useState(false);
  const [executingId, setExecutingId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [selectedExecution, setSelectedExecution] =
    useState<ExecutionDetail | null>(null);
  const [savedSignature, setSavedSignature] = useState("");
  const [runtimeVariables, setRuntimeVariables] = useState<VariableValue[]>([]);
  const [resolution, setResolution] = useState<{
    preview: RequestResolutionPreview;
    variables: Array<Omit<ResolvedVariable, "value">>;
    unresolved: string[];
    errors: VariableResolutionError[];
  } | null>(null);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/requests/${requestId}`, { signal: controller.signal })
      .then(async (response) => {
        const value = (await response.json()) as
          SavedRequestDetail | { error: string };
        if (!response.ok || "error" in value) {
          throw new Error(
            "error" in value ? value.error : "Request could not be loaded.",
          );
        }
        setSavedSignature(draftSignature(value));
        setDetail(value);
        setSelectedExecution(value.history[0] ?? null);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setLoadingError(
            error instanceof Error
              ? error.message
              : "Request could not be loaded.",
          );
        }
      });
    return () => controller.abort();
  }, [requestId]);

  const dirty = detail ? draftSignature(detail) !== savedSignature : false;
  const update = useCallback(
    (values: Partial<SavedRequestDetail>) =>
      setDetail((current) => (current ? { ...current, ...values } : current)),
    [],
  );

  const save = useCallback(async () => {
    if (!detail) return false;
    const wasModified = draftSignature(detail) !== savedSignature;
    setSaving(true);
    const result = await updateSavedRequestAction(normaliseDraft(detail));
    setSaving(false);
    if (!result.ok) {
      onNotice("error", result.error);
      return false;
    }
    setSavedSignature(draftSignature(detail));
    if (wasModified && detail.importSource) {
      setDetail((current) =>
        current?.importSource
          ? {
              ...current,
              importSource: { ...current.importSource, customized: true },
            }
          : current,
      );
    }
    onNotice("success", "Request saved.");
    onRefresh();
    return true;
  }, [detail, onNotice, onRefresh, savedSignature]);

  const send = useCallback(async () => {
    if (!detail || executingId) return;
    if (!(await save())) return;

    const executionId = crypto.randomUUID();
    setExecutingId(executionId);
    setCancelling(false);
    try {
      const response = await fetch(`/api/requests/${detail.id}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ executionId, runtimeVariables }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof payload === "object" &&
          payload !== null &&
          "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : "Request execution failed.";
        throw new Error(message);
      }
      const value = payload as ExecutionDetail;
      setSelectedExecution(value);
      setDetail((current) =>
        current
          ? {
              ...current,
              history: [
                value,
                ...current.history.filter((item) => item.id !== value.id),
              ].slice(0, 20),
            }
          : current,
      );
      onNotice(
        value.status === "succeeded" && value.assertionsPassed !== false
          ? "success"
          : "error",
        value.status === "succeeded" && value.assertionsPassed === false
          ? `Request completed, but ${value.assertionResults.filter(({ passed }) => !passed).length} assertion(s) failed.`
          : value.status === "succeeded"
            ? `Request completed with ${value.response?.statusCode ?? "a response"}.`
            : (value.error?.message ?? `Request ${value.status}.`),
      );
      onRefresh();
    } catch (error) {
      onNotice(
        "error",
        error instanceof Error ? error.message : "Request execution failed.",
      );
    } finally {
      setExecutingId(null);
      setCancelling(false);
    }
  }, [detail, executingId, onNotice, onRefresh, runtimeVariables, save]);

  const previewResolution = async () => {
    if (!detail || !(await save())) return;
    setResolving(true);
    try {
      const response = await fetch(`/api/requests/${detail.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runtimeVariables }),
      });
      const payload = (await response.json()) as
        | {
            preview: RequestResolutionPreview;
            variables: Array<Omit<ResolvedVariable, "value">>;
            unresolved: string[];
            errors: VariableResolutionError[];
          }
        | { error: string };
      if (!response.ok || "error" in payload) {
        throw new Error(
          "error" in payload
            ? payload.error
            : "Variables could not be resolved.",
        );
      }
      setResolution(payload);
      onNotice(
        payload.unresolved.length || payload.errors.length
          ? "error"
          : "success",
        payload.unresolved.length || payload.errors.length
          ? "Resolution preview found issues."
          : "Resolution preview is ready.",
      );
    } catch (error) {
      onNotice(
        "error",
        error instanceof Error
          ? error.message
          : "Variables could not be resolved.",
      );
    } finally {
      setResolving(false);
    }
  };

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void send();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [send]);

  const cancel = async () => {
    if (!executingId) return;
    setCancelling(true);
    const response = await fetch(`/api/executions/${executingId}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      setCancelling(false);
      onNotice("error", "The execution was no longer active.");
    }
  };

  const duplicate = async () => {
    if (!detail) return;
    const result = await duplicateSavedRequestAction({ requestId: detail.id });
    if (!result.ok) {
      onNotice("error", result.error);
      return;
    }
    onNotice("success", `Duplicated ${detail.name}.`);
    onSelectRequest(result.data.id);
    onRefresh();
  };

  const saveAsCustom = async () => {
    if (!detail?.importSource) return;
    if (dirty && !(await save())) return;
    const result = await detachImportedRequestAction({ requestId: detail.id });
    if (!result.ok) {
      onNotice("error", result.error);
      return;
    }
    setDetail((current) =>
      current ? { ...current, importSource: null } : current,
    );
    onNotice(
      "success",
      "Request saved as custom. Future OpenAPI refreshes will not change it.",
    );
    onRefresh();
  };

  if (loadingError) {
    return (
      <main className="grid min-w-0 flex-1 place-items-center p-8 text-center">
        <div>
          <AlertTriangle
            aria-hidden="true"
            className="mx-auto size-7 text-red-500"
          />
          <h1 className="mt-3 text-base font-semibold">
            Request could not be loaded
          </h1>
          <p className="mt-1 text-sm text-muted">{loadingError}</p>
        </div>
      </main>
    );
  }

  if (!detail) {
    return (
      <main className="grid min-w-0 flex-1 place-items-center">
        <LoaderCircle
          aria-label="Loading request"
          className="size-6 animate-spin text-accent"
        />
      </main>
    );
  }

  const flatFolders = flattenFolders(folders);
  const bodyPlaceholder =
    detail.body.type === "multipart"
      ? 'One name=value field per line, or JSON: [{"name":"file","value":"..."}]'
      : detail.body.type === "form_urlencoded"
        ? "name=value\nsecond=value"
        : detail.body.type === "binary"
          ? "Select a file below or paste base64/text content"
          : "Request body";

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="border-b bg-surface px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="HTTP method"
            className="h-10 rounded-md border bg-surface-subtle px-2 font-mono text-xs font-bold"
            onChange={(event) =>
              update({
                method: event.target.value as SavedRequestDetail["method"],
              })
            }
            value={detail.method}
          >
            {httpMethods.map((method) => (
              <option key={method}>{method}</option>
            ))}
          </select>
          <input
            aria-label="Request URL"
            className="h-10 min-w-64 flex-1 rounded-md border bg-surface-subtle px-3 font-mono text-xs shadow-inner"
            onChange={(event) => update({ url: event.target.value })}
            placeholder="https://api.example.test/resource"
            value={detail.url}
          />
          {executingId ? (
            <Button
              disabled={cancelling}
              onClick={cancel}
              variant="destructive"
            >
              <Square aria-hidden="true" className="size-3.5 fill-current" />
              {cancelling ? "Cancelling…" : "Cancel"}
            </Button>
          ) : (
            <Button onClick={send}>
              <Send aria-hidden="true" className="size-4" /> Send
              <kbd className="ml-1 rounded bg-black/15 px-1 text-[9px]">⌘↵</kbd>
            </Button>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            aria-label="Request name"
            className="h-8 min-w-52 rounded-md border bg-transparent px-2 text-sm font-semibold"
            onChange={(event) => update({ name: event.target.value })}
            value={detail.name}
          />
          {dirty ? (
            <span className="text-[10px] text-warning">Unsaved changes</span>
          ) : null}
          <div className="ml-auto flex items-center gap-1">
            <Button
              disabled={saving}
              onClick={save}
              size="sm"
              variant="secondary"
            >
              <Save aria-hidden="true" className="size-3.5" />{" "}
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button
              aria-label="Duplicate request"
              onClick={duplicate}
              size="icon"
              variant="ghost"
            >
              <Copy aria-hidden="true" className="size-3.5" />
            </Button>
            <Button
              aria-label="Delete request"
              onClick={() => onDelete({ id: detail.id, name: detail.name })}
              size="icon"
              variant="ghost"
            >
              <Trash2 aria-hidden="true" className="size-3.5 text-red-500" />
            </Button>
          </div>
        </div>
        {detail.importSource ? (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-accent/25 bg-accent/10 px-3 py-2 text-[11px]">
            <span className="min-w-0 flex-1 text-muted">
              Imported from{" "}
              <span className="font-medium text-foreground">
                {detail.importSource.definitionName}
              </span>{" "}
              · {detail.importSource.sourceKey}.{" "}
              {detail.importSource.customized
                ? "Customized; refreshes will not overwrite this request."
                : "Refreshes update this request only while it remains unmodified."}
            </span>
            <Button onClick={saveAsCustom} size="sm" variant="secondary">
              <Unlink aria-hidden="true" className="size-3.5" /> Save as custom
              request
            </Button>
          </div>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <section className="min-h-64 flex-1 overflow-auto bg-surface">
          <div className="flex border-b px-3">
            {requestTabs.map((item) => {
              const count =
                item === "Params"
                  ? detail.queryParameters.length
                  : item === "Headers"
                    ? detail.headers.length
                    : item === "Cookies"
                      ? detail.settings.cookies.length
                      : item === "Variables"
                        ? detail.requestVariables.length
                        : item === "Tests"
                          ? detail.assertions.length
                          : null;
              return (
                <button
                  className={cn(
                    "border-b-2 border-transparent px-3 py-2.5 text-[11px] font-medium text-muted",
                    tab === item && "border-accent text-foreground",
                  )}
                  key={item}
                  onClick={() => setTab(item)}
                  type="button"
                >
                  {item}
                  {count ? ` ${count}` : ""}
                </button>
              );
            })}
          </div>
          <div className="p-4">
            {tab === "Params" ? (
              <RequestFieldEditor
                emptyLabel="No query parameters."
                items={detail.queryParameters}
                onChange={(queryParameters) => update({ queryParameters })}
              />
            ) : null}
            {tab === "Headers" ? (
              <RequestFieldEditor
                allowSecrets
                emptyLabel="No request headers."
                items={detail.headers}
                onChange={(headers) => update({ headers })}
              />
            ) : null}
            {tab === "Cookies" ? (
              <RequestFieldEditor
                allowSecrets
                emptyLabel="No request cookies. Cookie values are redacted in history."
                items={detail.settings.cookies as RequestField[]}
                onChange={(cookies) =>
                  update({ settings: { ...detail.settings, cookies } })
                }
              />
            ) : null}
            {tab === "Auth" ? (
              <div className="max-w-3xl space-y-4">
                <label className="space-y-1.5 text-xs font-medium">
                  Authentication profile
                  <select
                    aria-label="Authentication profile"
                    className="h-10 w-full rounded-md border bg-surface-subtle px-2.5 text-xs"
                    onChange={(event) =>
                      update({ authProfileId: event.target.value || null })
                    }
                    value={detail.authProfileId ?? ""}
                  >
                    <option value="">No authentication</option>
                    {detail.availableAuthProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name} · {profile.type.replaceAll("_", " ")} ·{" "}
                        {profile.scope}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex gap-3 rounded-lg border bg-surface-subtle p-4 text-xs text-muted">
                  <KeyRound
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-accent"
                  />
                  <p className="leading-5">
                    Credentials are resolved by the server immediately before
                    execution. OAuth and request-derived profiles reuse fresh
                    cached tokens and retain only a redacted trace in history.
                  </p>
                </div>
              </div>
            ) : null}
            {tab === "Variables" ? (
              <div className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1.5 text-xs font-medium">
                    Workspace environment
                    <select
                      aria-label="Workspace environment"
                      className="h-9 w-full rounded-md border bg-surface-subtle px-2.5 text-xs"
                      onChange={(event) =>
                        update({
                          settings: {
                            ...detail.settings,
                            workspaceEnvironmentId: event.target.value || null,
                          },
                        })
                      }
                      value={detail.settings.workspaceEnvironmentId ?? ""}
                    >
                      <option value="">No workspace environment</option>
                      {detail.availableEnvironments.workspace.map(
                        (environment) => (
                          <option key={environment.id} value={environment.id}>
                            {environment.name}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                  <label className="space-y-1.5 text-xs font-medium">
                    Project environment
                    <select
                      aria-label="Project environment"
                      className="h-9 w-full rounded-md border bg-surface-subtle px-2.5 text-xs"
                      onChange={(event) =>
                        update({
                          settings: {
                            ...detail.settings,
                            projectEnvironmentId: event.target.value || null,
                          },
                        })
                      }
                      value={detail.settings.projectEnvironmentId ?? ""}
                    >
                      <option value="">No project environment</option>
                      {detail.availableEnvironments.project.map(
                        (environment) => (
                          <option key={environment.id} value={environment.id}>
                            {environment.name}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                </div>

                <div>
                  <h3 className="text-xs font-semibold">Request variables</h3>
                  <p className="mt-1 mb-2 text-[11px] text-muted">
                    Persisted with this request and resolved above generated,
                    project, and workspace values.
                  </p>
                  <VariableRowsEditor
                    onChange={(requestVariables) =>
                      update({ requestVariables })
                    }
                    variables={detail.requestVariables}
                  />
                </div>

                <div>
                  <h3 className="text-xs font-semibold">
                    Temporary runtime overrides
                  </h3>
                  <p className="mt-1 mb-2 text-[11px] text-muted">
                    Used for the next preview or send only. These values are
                    never saved.
                  </p>
                  <VariableRowsEditor
                    defaultSecret
                    emptyLabel="No temporary overrides."
                    onChange={setRuntimeVariables}
                    variables={runtimeVariables}
                  />
                </div>

                <Button
                  disabled={resolving}
                  onClick={previewResolution}
                  variant="secondary"
                >
                  <Braces aria-hidden="true" className="size-4" />
                  {resolving ? "Resolving…" : "Preview resolved request"}
                </Button>

                {resolution ? (
                  <div className="space-y-3 rounded-lg border bg-code-background p-4 font-mono text-xs">
                    <div>
                      <span className="text-muted">Resolved URL</span>
                      <p className="mt-1 break-all text-foreground">
                        {resolution.preview.url}
                      </p>
                    </div>
                    {resolution.unresolved.length ? (
                      <p className="text-red-400">
                        Unresolved: {resolution.unresolved.join(", ")}
                      </p>
                    ) : null}
                    {resolution.errors.map((error) => (
                      <p
                        className="text-red-400"
                        key={`${error.code}:${error.path.join(":")}`}
                      >
                        {error.message}
                      </p>
                    ))}
                    <div className="grid gap-1 border-t pt-3">
                      {resolution.variables.length ? (
                        resolution.variables.map((variable) => (
                          <div
                            className="grid gap-2 sm:grid-cols-[140px_1fr_220px]"
                            key={variable.name}
                          >
                            <span>{variable.name}</span>
                            <span className="truncate text-accent">
                              {variable.preview}
                            </span>
                            <span className="truncate text-muted">
                              {variable.originLabel}
                            </span>
                          </div>
                        ))
                      ) : (
                        <span className="text-muted">
                          No variables are active.
                        </span>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
            {tab === "Body" ? (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <label className="text-xs font-medium">
                    <span className="sr-only">Body type</span>
                    <select
                      aria-label="Body type"
                      className="h-9 rounded-md border bg-surface-subtle px-2"
                      onChange={(event) =>
                        update({
                          body: {
                            ...detail.body,
                            type: event.target
                              .value as SavedRequestDetail["body"]["type"],
                          },
                        })
                      }
                      value={detail.body.type}
                    >
                      {requestBodyTypes.map((type) => (
                        <option key={type} value={type}>
                          {type.replaceAll("_", " ")}
                        </option>
                      ))}
                    </select>
                  </label>
                  <input
                    aria-label="Body content type"
                    className="h-9 min-w-56 rounded-md border bg-surface-subtle px-2.5 font-mono text-xs"
                    onChange={(event) =>
                      update({
                        body: {
                          ...detail.body,
                          contentType: event.target.value || null,
                        },
                      })
                    }
                    placeholder="Content-Type override"
                    value={detail.body.contentType ?? ""}
                  />
                  {detail.body.type === "binary" ? (
                    <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border bg-surface-subtle px-3 text-xs">
                      <FileUp aria-hidden="true" className="size-3.5" /> Choose
                      file
                      <input
                        className="sr-only"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (!file) return;
                          const reader = new FileReader();
                          reader.onload = () =>
                            update({
                              body: {
                                ...detail.body,
                                content:
                                  String(reader.result).split(",")[1] ?? "",
                                contentType:
                                  file.type || "application/octet-stream",
                                metadata: {
                                  encoding: "base64",
                                  filename: file.name,
                                },
                              },
                            });
                          reader.readAsDataURL(file);
                        }}
                        type="file"
                      />
                    </label>
                  ) : null}
                </div>
                {detail.body.type !== "none" ? (
                  <textarea
                    aria-label="Request body"
                    className="min-h-44 w-full resize-y rounded-lg border bg-code-background p-3 font-mono text-xs leading-5"
                    onChange={(event) =>
                      update({
                        body: { ...detail.body, content: event.target.value },
                      })
                    }
                    placeholder={bodyPlaceholder}
                    value={detail.body.content ?? ""}
                  />
                ) : (
                  <p className="rounded-lg border border-dashed p-8 text-center text-xs text-muted">
                    This request has no body.
                  </p>
                )}
              </div>
            ) : null}
            {tab === "Outputs" ? (
              <div className="space-y-4">
                <div>
                  <h3 className="text-xs font-semibold">Published outputs</h3>
                  <p className="mt-1 text-[11px] leading-5 text-muted">
                    Extract values from successful JSON responses. The newest
                    unexpired value becomes a generated variable for later
                    requests in this project.
                  </p>
                </div>
                {detail.outputDefinitions.length ? (
                  <div className="space-y-2">
                    {detail.outputDefinitions.map((output, index) => (
                      <div
                        className="grid gap-2 rounded-lg border bg-surface-subtle p-3 sm:grid-cols-[1fr_1.35fr_1.35fr_auto_auto]"
                        key={index}
                      >
                        <input
                          aria-label={`Output ${index + 1} name`}
                          className="h-9 rounded-md border bg-background px-2.5 font-mono text-xs"
                          onChange={(event) => {
                            const outputDefinitions = [
                              ...detail.outputDefinitions,
                            ];
                            outputDefinitions[index] = {
                              ...output,
                              name: event.target.value,
                            };
                            update({ outputDefinitions });
                          }}
                          placeholder="accessToken"
                          value={output.name}
                        />
                        <input
                          aria-label={`Output ${index + 1} JSONPath`}
                          className="h-9 rounded-md border bg-background px-2.5 font-mono text-xs"
                          onChange={(event) => {
                            const outputDefinitions = [
                              ...detail.outputDefinitions,
                            ];
                            outputDefinitions[index] = {
                              ...output,
                              jsonPath: event.target.value,
                            };
                            update({ outputDefinitions });
                          }}
                          placeholder="$.access_token"
                          value={output.jsonPath}
                        />
                        <input
                          aria-label={`Output ${index + 1} expiry JSONPath`}
                          className="h-9 rounded-md border bg-background px-2.5 font-mono text-xs"
                          onChange={(event) => {
                            const outputDefinitions = [
                              ...detail.outputDefinitions,
                            ];
                            outputDefinitions[index] = {
                              ...output,
                              expiresInJsonPath: event.target.value || null,
                            };
                            update({ outputDefinitions });
                          }}
                          placeholder="Expiry seconds path (optional)"
                          value={output.expiresInJsonPath ?? ""}
                        />
                        <label className="flex h-9 items-center gap-2 px-1 text-xs">
                          <input
                            checked={output.secret}
                            className="size-4 accent-accent"
                            onChange={(event) => {
                              const outputDefinitions = [
                                ...detail.outputDefinitions,
                              ];
                              outputDefinitions[index] = {
                                ...output,
                                secret: event.target.checked,
                              };
                              update({ outputDefinitions });
                            }}
                            type="checkbox"
                          />
                          Secret
                        </label>
                        <Button
                          aria-label={`Remove output ${index + 1}`}
                          onClick={() =>
                            update({
                              outputDefinitions:
                                detail.outputDefinitions.filter(
                                  (_, candidate) => candidate !== index,
                                ),
                            })
                          }
                          size="icon"
                          variant="ghost"
                        >
                          <Trash2 aria-hidden="true" className="size-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-lg border border-dashed p-8 text-center text-xs text-muted">
                    This request does not publish outputs yet.
                  </p>
                )}
                <Button
                  onClick={() =>
                    update({
                      outputDefinitions: [
                        ...detail.outputDefinitions,
                        {
                          name: "",
                          jsonPath: "$.value",
                          expiresInJsonPath: null,
                          secret: false,
                        },
                      ],
                    })
                  }
                  variant="secondary"
                >
                  <Plus aria-hidden="true" className="size-4" /> Add output
                </Button>
              </div>
            ) : null}
            {tab === "Tests" ? (
              <div className="space-y-4">
                <div>
                  <h3 className="text-xs font-semibold">Response assertions</h3>
                  <p className="mt-1 text-[11px] leading-5 text-muted">
                    Assertions run after every send and are stored with the
                    execution report. They use the same evaluator as workflows
                    and future headless runs.
                  </p>
                </div>
                <AssertionEditor
                  assertions={detail.assertions}
                  onChange={(assertions) => update({ assertions })}
                />
              </div>
            ) : null}
            {tab === "Settings" ? (
              <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
                <label className="space-y-1.5 text-xs font-medium">
                  Description
                  <textarea
                    className="min-h-20 w-full rounded-md border bg-surface-subtle p-2.5 text-xs"
                    onChange={(event) =>
                      update({ description: event.target.value })
                    }
                    value={detail.description ?? ""}
                  />
                </label>
                <label className="space-y-1.5 text-xs font-medium">
                  Tags{" "}
                  <span className="font-normal text-muted">
                    Comma separated
                  </span>
                  <input
                    className="h-9 w-full rounded-md border bg-surface-subtle px-2.5 text-xs"
                    onChange={(event) =>
                      update({
                        tags: event.target.value
                          .split(",")
                          .map((tag) => tag.trim())
                          .filter(Boolean),
                      })
                    }
                    value={detail.tags.join(", ")}
                  />
                </label>
                <label className="space-y-1.5 text-xs font-medium">
                  Folder
                  <select
                    className="h-9 w-full rounded-md border bg-surface-subtle px-2.5 text-xs"
                    onChange={(event) =>
                      update({ folderId: event.target.value || null })
                    }
                    value={detail.folderId ?? ""}
                  >
                    <option value="">Project root</option>
                    {flatFolders.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {`${"— ".repeat(folder.depth)}${folder.name}`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1.5 text-xs font-medium">
                  Timeout (ms)
                  <input
                    className="h-9 w-full rounded-md border bg-surface-subtle px-2.5 font-mono text-xs"
                    max={120000}
                    min={100}
                    onChange={(event) =>
                      update({
                        settings: {
                          ...detail.settings,
                          timeoutMs: Number(event.target.value),
                        },
                      })
                    }
                    type="number"
                    value={detail.settings.timeoutMs}
                  />
                </label>
                <label className="space-y-1.5 text-xs font-medium">
                  Maximum response bytes
                  <input
                    className="h-9 w-full rounded-md border bg-surface-subtle px-2.5 font-mono text-xs"
                    max={10485760}
                    min={1024}
                    onChange={(event) =>
                      update({
                        settings: {
                          ...detail.settings,
                          maxResponseBytes: Number(event.target.value),
                        },
                      })
                    }
                    type="number"
                    value={detail.settings.maxResponseBytes}
                  />
                </label>
                <label className="space-y-1.5 text-xs font-medium">
                  Redirect limit
                  <input
                    className="h-9 w-full rounded-md border bg-surface-subtle px-2.5 font-mono text-xs"
                    max={10}
                    min={0}
                    onChange={(event) =>
                      update({
                        settings: {
                          ...detail.settings,
                          maxRedirects: Number(event.target.value),
                        },
                      })
                    }
                    type="number"
                    value={detail.settings.maxRedirects}
                  />
                </label>
                {[
                  ["Follow redirects", "followRedirects"],
                  ["Verify TLS certificates", "tlsVerify"],
                  [
                    "Allow trusted private/local network",
                    "allowPrivateNetwork",
                  ],
                ].map(([label, key]) => (
                  <label className="flex items-center gap-2 text-xs" key={key}>
                    <input
                      checked={Boolean(
                        detail.settings[key as keyof typeof detail.settings],
                      )}
                      className="size-4 accent-accent"
                      onChange={(event) =>
                        update({
                          settings: {
                            ...detail.settings,
                            [key]: event.target.checked,
                          },
                        })
                      }
                      type="checkbox"
                    />
                    {label}
                  </label>
                ))}
                {detail.settings.allowPrivateNetwork ||
                !detail.settings.tlsVerify ? (
                  <div className="flex gap-2 rounded-lg border border-warning/35 bg-warning/10 p-3 text-xs text-warning sm:col-span-2">
                    <AlertTriangle
                      aria-hidden="true"
                      className="mt-0.5 size-4 shrink-0"
                    />
                    These overrides reduce outbound request isolation. Cloud
                    metadata endpoints remain blocked.
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>
        <ResponseViewer
          execution={selectedExecution}
          history={detail.history}
          onSelectHistory={setSelectedExecution}
        />
      </div>
    </main>
  );
}
