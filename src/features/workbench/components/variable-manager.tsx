"use client";

import {
  ArrowLeft,
  Copy,
  Layers3,
  LoaderCircle,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  createEnvironmentAction,
  deleteEnvironmentAction,
  duplicateEnvironmentAction,
  saveVariableScopeAction,
  updateEnvironmentAction,
} from "@/features/variables/actions";
import type {
  VariableConfiguration,
  VariableValue,
} from "@/features/variables/domain";
import { cn } from "@/lib/utils";

import { VariableRowsEditor } from "./variable-rows-editor";

interface Selection {
  kind: "base" | "environment";
  id?: string;
}

async function fetchVariableConfiguration(
  workspaceId: string,
  projectId?: string,
) {
  const query = new URLSearchParams({ workspaceId });
  if (projectId) query.set("projectId", projectId);
  const response = await fetch(`/api/configuration/variables?${query}`);
  const payload = (await response.json()) as
    VariableConfiguration | { error: string };
  if (!response.ok || "error" in payload) {
    throw new Error(
      "error" in payload
        ? payload.error
        : "Variable configuration could not be loaded.",
    );
  }
  return payload;
}

function editableVariables(
  variables: Array<
    Pick<VariableValue, "name" | "value" | "secret" | "enabled">
  >,
) {
  return variables.map(({ name, value, secret, enabled }) => ({
    name,
    value,
    secret,
    enabled,
  }));
}

export function VariableManager({
  onClose,
  project,
  workspace,
}: {
  onClose: () => void;
  project?: { id: string; name: string };
  workspace: { id: string; name: string };
}) {
  const [configuration, setConfiguration] =
    useState<VariableConfiguration | null>(null);
  const [selection, setSelection] = useState<Selection>({ kind: "base" });
  const [draft, setDraft] = useState<VariableValue[]>([]);
  const [environmentName, setEnvironmentName] = useState("");
  const [environmentDescription, setEnvironmentDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const projectId = project?.id;

  const load = useCallback(async () => {
    const payload = await fetchVariableConfiguration(workspace.id, projectId);
    setConfiguration(payload);
    return payload;
  }, [projectId, workspace.id]);

  useEffect(() => {
    let active = true;
    fetchVariableConfiguration(workspace.id, projectId)
      .then((payload) => {
        if (!active) return;
        setConfiguration(payload);
        setDraft(
          editableVariables(
            projectId ? payload.projectVariables : payload.workspaceVariables,
          ),
        );
      })
      .catch((error: unknown) => {
        if (!active) return;
        setNotice({
          tone: "error",
          text:
            error instanceof Error
              ? error.message
              : "Variable configuration could not be loaded.",
        });
      });
    return () => {
      active = false;
    };
  }, [projectId, workspace.id]);

  const environments = project
    ? (configuration?.projectEnvironments ?? [])
    : (configuration?.workspaceEnvironments ?? []);
  const selectedEnvironment =
    selection.kind === "environment"
      ? environments.find(({ id }) => id === selection.id)
      : undefined;

  const selectBase = () => {
    setSelection({ kind: "base" });
    setDraft(
      editableVariables(
        projectId
          ? (configuration?.projectVariables ?? [])
          : (configuration?.workspaceVariables ?? []),
      ),
    );
  };

  const selectEnvironment = (environment: (typeof environments)[number]) => {
    setSelection({ kind: "environment", id: environment.id });
    setDraft(editableVariables(environment.variables));
    setEnvironmentName(environment.name);
    setEnvironmentDescription(environment.description ?? "");
  };

  const run = async (
    mutation: () => Promise<{ ok: boolean; error?: string }>,
    success: string,
    after?: () => void,
  ) => {
    setBusy(true);
    setNotice(null);
    const result = await mutation();
    if (!result.ok) {
      setNotice({ tone: "error", text: result.error ?? "Change failed." });
      setBusy(false);
      return false;
    }
    after?.();
    await load();
    setNotice({ tone: "success", text: success });
    setBusy(false);
    return true;
  };

  const saveVariables = () =>
    run(
      () =>
        saveVariableScopeAction({
          scope:
            selection.kind === "environment"
              ? project
                ? "project_environment"
                : "workspace_environment"
              : project
                ? "project"
                : "workspace",
          workspaceId:
            !project && selection.kind === "base" ? workspace.id : null,
          projectId: project && selection.kind === "base" ? project.id : null,
          environmentId:
            selection.kind === "environment" ? selectedEnvironment?.id : null,
          requestId: null,
          variables: draft,
        }),
      "Variables saved.",
    );

  const createEnvironment = (event: FormEvent) => {
    event.preventDefault();
    void run(
      () =>
        createEnvironmentAction({
          workspaceId: workspace.id,
          projectId: project?.id ?? null,
          name: environmentName,
          description: environmentDescription,
        }),
      "Environment created.",
      () => {
        setCreating(false);
        setEnvironmentName("");
        setEnvironmentDescription("");
        selectBase();
      },
    );
  };

  const updateSelectedEnvironment = () => {
    if (!selectedEnvironment) return;
    void run(
      () =>
        updateEnvironmentAction({
          id: selectedEnvironment.id,
          name: environmentName,
          description: environmentDescription,
        }),
      "Environment updated.",
    );
  };

  const deleteSelectedEnvironment = () => {
    if (!selectedEnvironment) return;
    if (!window.confirm(`Delete ${selectedEnvironment.name}?`)) return;
    void run(
      () => deleteEnvironmentAction({ environmentId: selectedEnvironment.id }),
      "Environment deleted.",
      selectBase,
    );
  };

  return (
    <main className="min-w-0 flex-1 overflow-auto bg-background p-5 sm:p-7">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-start gap-3">
          <Button
            aria-label="Close variable manager"
            onClick={onClose}
            size="icon"
            variant="ghost"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
          </Button>
          <div>
            <p className="text-[0.625rem] font-semibold tracking-[0.14em] text-muted uppercase">
              {project ? "Project configuration" : "Workspace configuration"}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              {project?.name ?? workspace.name} variables
            </h1>
            <p className="mt-1 text-sm text-muted">
              More specific values override broader scopes. Secret values stay
              masked in previews and history.
            </p>
          </div>
        </div>

        {notice ? (
          <div
            className={cn(
              "mt-5 rounded-lg border px-3 py-2 text-xs",
              notice.tone === "success"
                ? "border-success/30 bg-success/10 text-success"
                : "border-red-500/30 bg-red-500/10 text-red-500",
            )}
            role="status"
          >
            {notice.text}
          </div>
        ) : null}

        {!configuration ? (
          <div className="grid min-h-64 place-items-center">
            <LoaderCircle
              aria-label="Loading variables"
              className="size-6 animate-spin text-accent"
            />
          </div>
        ) : (
          <div className="mt-6 grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
            <aside className="rounded-xl border bg-surface p-2 shadow-sm">
              <button
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs",
                  selection.kind === "base"
                    ? "bg-surface-strong font-medium"
                    : "text-muted",
                )}
                onClick={selectBase}
                type="button"
              >
                <Layers3 aria-hidden="true" className="size-3.5" /> Base
                variables
              </button>
              <p className="mt-4 px-3 text-[0.625rem] font-semibold tracking-wider text-muted uppercase">
                Environments
              </p>
              {environments.map((environment) => (
                <button
                  className={cn(
                    "mt-1 w-full rounded-lg px-3 py-2 text-left text-xs",
                    selection.id === environment.id
                      ? "bg-surface-strong font-medium"
                      : "text-muted hover:text-foreground",
                  )}
                  key={environment.id}
                  onClick={() => selectEnvironment(environment)}
                  type="button"
                >
                  {environment.name}
                  <span className="mt-0.5 block text-[0.625rem] font-normal text-muted">
                    {environment.variables.length} variables
                  </span>
                </button>
              ))}
              <button
                className="mt-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-accent"
                onClick={() => {
                  setCreating(true);
                  setEnvironmentName("");
                  setEnvironmentDescription("");
                }}
                type="button"
              >
                <Plus aria-hidden="true" className="size-3.5" /> New environment
              </button>
            </aside>

            <section className="rounded-xl border bg-surface p-5 shadow-sm">
              {creating ? (
                <form className="space-y-4" onSubmit={createEnvironment}>
                  <div>
                    <h2 className="text-sm font-semibold">
                      Create environment
                    </h2>
                    <p className="mt-1 text-xs text-muted">
                      Examples: Local, Dev, Test, Staging, or Production.
                    </p>
                  </div>
                  <label className="block space-y-1.5 text-xs font-medium">
                    Name
                    <input
                      autoFocus
                      className="h-9 w-full rounded-md border bg-surface-subtle px-2.5"
                      onChange={(event) =>
                        setEnvironmentName(event.target.value)
                      }
                      value={environmentName}
                    />
                  </label>
                  <label className="block space-y-1.5 text-xs font-medium">
                    Description
                    <textarea
                      className="min-h-20 w-full rounded-md border bg-surface-subtle p-2.5"
                      onChange={(event) =>
                        setEnvironmentDescription(event.target.value)
                      }
                      value={environmentDescription}
                    />
                  </label>
                  <div className="flex gap-2">
                    <Button disabled={busy} type="submit">
                      Create
                    </Button>
                    <Button
                      onClick={() => setCreating(false)}
                      type="button"
                      variant="secondary"
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="space-y-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold">
                        {selectedEnvironment?.name ??
                          `${project ? "Project" : "Workspace"} variables`}
                      </h2>
                      <p className="mt-1 text-xs text-muted">
                        {selectedEnvironment
                          ? "Values apply when this environment is selected on a request."
                          : `Values apply to every request in this ${project ? "project" : "workspace"}.`}
                      </p>
                    </div>
                    {selectedEnvironment ? (
                      <div className="flex gap-1">
                        <Button
                          aria-label="Duplicate environment"
                          disabled={busy}
                          onClick={() =>
                            void run(
                              () =>
                                duplicateEnvironmentAction({
                                  environmentId: selectedEnvironment.id,
                                }),
                              "Environment duplicated.",
                            )
                          }
                          size="icon"
                          variant="ghost"
                        >
                          <Copy aria-hidden="true" className="size-3.5" />
                        </Button>
                        <Button
                          aria-label="Delete environment"
                          disabled={busy}
                          onClick={deleteSelectedEnvironment}
                          size="icon"
                          variant="ghost"
                        >
                          <Trash2
                            aria-hidden="true"
                            className="size-3.5 text-red-500"
                          />
                        </Button>
                      </div>
                    ) : null}
                  </div>

                  {selectedEnvironment ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="space-y-1.5 text-xs font-medium">
                        Environment name
                        <input
                          className="h-9 w-full rounded-md border bg-surface-subtle px-2.5"
                          onChange={(event) =>
                            setEnvironmentName(event.target.value)
                          }
                          value={environmentName}
                        />
                      </label>
                      <label className="space-y-1.5 text-xs font-medium">
                        Description
                        <input
                          className="h-9 w-full rounded-md border bg-surface-subtle px-2.5"
                          onChange={(event) =>
                            setEnvironmentDescription(event.target.value)
                          }
                          value={environmentDescription}
                        />
                      </label>
                      <Button
                        className="w-fit"
                        disabled={busy}
                        onClick={updateSelectedEnvironment}
                        size="sm"
                        variant="secondary"
                      >
                        Save environment details
                      </Button>
                    </div>
                  ) : null}

                  <VariableRowsEditor onChange={setDraft} variables={draft} />
                  <div className="flex justify-end">
                    <Button
                      disabled={busy}
                      onClick={() => void saveVariables()}
                    >
                      <Save aria-hidden="true" className="size-4" />{" "}
                      {busy ? "Saving…" : "Save variables"}
                    </Button>
                  </div>

                  {project && configuration.workspaceVariables.length ? (
                    <div className="rounded-lg border border-dashed p-3 text-xs text-muted">
                      This project also inherits{" "}
                      {configuration.workspaceVariables.length} workspace
                      variable
                      {configuration.workspaceVariables.length === 1 ? "" : "s"}
                      ; matching project names override them.
                    </div>
                  ) : null}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
