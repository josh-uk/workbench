"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  LoaderCircle,
  Play,
  Plus,
  Save,
  Trash2,
  Workflow,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { AssertionDefinition } from "@/core/assertions/domain";
import type { VariableValue } from "@/features/variables/domain";
import {
  deleteWorkflowAction,
  getWorkflowDetailAction,
  getWorkflowRunReportAction,
  listWorkflowsAction,
  saveWorkflowAction,
} from "@/features/workflows/actions";
import type {
  WorkflowRequestOption,
  WorkflowRunReport,
  WorkflowSummary,
} from "@/features/workflows/domain";
import { cn } from "@/lib/utils";

import { AssertionEditor } from "./assertion-editor";
import { VariableRowsEditor } from "./variable-rows-editor";

interface WorkflowDraftStep {
  id?: string;
  requestId: string;
  name: string;
  failureMode: "stop" | "continue";
  enabled: boolean;
  runtimeOverrides: VariableValue[];
  assertions: AssertionDefinition[];
}

interface WorkflowDraft {
  id?: string;
  name: string;
  description: string;
  steps: WorkflowDraftStep[];
}

type Notice = (tone: "success" | "error", text: string) => void;

function statusClass(status: WorkflowRunReport["status"]) {
  return status === "succeeded"
    ? "text-success"
    : status === "running"
      ? "text-accent"
      : status === "cancelled"
        ? "text-warning"
        : "text-red-500";
}

function RunReport({ report }: { report: WorkflowRunReport }) {
  return (
    <section className="space-y-3 rounded-xl border bg-code-background p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="font-semibold">Execution report</h3>
        <span
          className={cn(
            "font-mono text-xs font-bold uppercase",
            statusClass(report.status),
          )}
        >
          {report.status}
        </span>
        <span className="text-xs text-muted">
          {report.summary.passed} passed · {report.summary.failed} failed ·{" "}
          {report.summary.attempted}/{report.summary.total} attempted
        </span>
        {report.summary.stoppedEarly ? (
          <span className="text-xs text-warning">Stopped early</span>
        ) : null}
      </div>
      {report.error ? (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-500">
          {report.error.message}
        </p>
      ) : null}
      <div className="space-y-2">
        {report.steps.map((step) => (
          <article className="rounded-lg border bg-surface p-3" key={step.id}>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="grid size-5 place-items-center rounded-full border font-mono text-[10px] text-muted">
                {step.position + 1}
              </span>
              <span className="font-semibold">{step.name}</span>
              <span
                className={cn(
                  "font-mono text-[10px] font-semibold uppercase",
                  statusClass(step.status),
                )}
              >
                {step.status}
              </span>
              {step.execution?.response ? (
                <span className="text-muted">
                  HTTP {step.execution.response.statusCode} ·{" "}
                  {step.execution.response.durationMs} ms
                </span>
              ) : null}
              <span className="ml-auto text-[10px] text-muted">
                On failure: {step.failureMode}
              </span>
            </div>
            {step.error ? (
              <p className="mt-2 text-xs text-red-500">{step.error.message}</p>
            ) : null}
            {step.assertionResults.length ? (
              <ul className="mt-2 space-y-1 text-xs">
                {step.assertionResults.map((assertion, index) => (
                  <li
                    className={assertion.passed ? "text-muted" : "text-red-500"}
                    key={`${assertion.assertionId ?? assertion.name}-${index}`}
                  >
                    {assertion.passed ? "✓" : "✕"} {assertion.name} —{" "}
                    {assertion.message}
                  </li>
                ))}
              </ul>
            ) : null}
            {step.outputNames.length ? (
              <p className="mt-2 text-[11px] text-muted">
                Published for later steps: {step.outputNames.join(", ")}
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

export function WorkflowManager({
  onClose,
  onNotice,
  onRefresh,
  project,
}: {
  onClose: () => void;
  onNotice: Notice;
  onRefresh: () => void;
  project: { id: string; name: string; requests: WorkflowRequestOption[] };
}) {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [draft, setDraft] = useState<WorkflowDraft | null>(null);
  const [report, setReport] = useState<WorkflowRunReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    const result = await listWorkflowsAction({ projectId: project.id });
    setLoading(false);
    if (!result.ok) {
      onNotice("error", result.error);
      return;
    }
    setWorkflows(result.data);
  }, [onNotice, project.id]);

  useEffect(() => {
    let cancelled = false;
    async function loadInitialWorkflows() {
      const result = await listWorkflowsAction({ projectId: project.id });
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) onNotice("error", result.error);
      else setWorkflows(result.data);
    }
    void loadInitialWorkflows();
    return () => {
      cancelled = true;
    };
  }, [onNotice, project.id]);

  const edit = async (workflowId: string) => {
    setPending(true);
    setReport(null);
    const result = await getWorkflowDetailAction({ workflowId });
    setPending(false);
    if (!result.ok) {
      onNotice("error", result.error);
      return;
    }
    setDraft({
      id: result.data.id,
      name: result.data.name,
      description: result.data.description ?? "",
      steps: result.data.steps.map((step) => ({
        id: step.id,
        requestId: step.requestId,
        name: step.name,
        failureMode: step.failureMode,
        enabled: step.enabled,
        runtimeOverrides: step.runtimeOverrides,
        assertions: step.assertions,
      })),
    });
  };

  const updateStep = (index: number, values: Partial<WorkflowDraftStep>) => {
    if (!draft) return;
    setDraft({
      ...draft,
      steps: draft.steps.map((step, candidate) =>
        candidate === index ? { ...step, ...values } : step,
      ),
    });
  };

  const moveStep = (index: number, direction: -1 | 1) => {
    if (!draft) return;
    const target = index + direction;
    if (target < 0 || target >= draft.steps.length) return;
    const steps = [...draft.steps];
    [steps[index], steps[target]] = [steps[target]!, steps[index]!];
    setDraft({ ...draft, steps });
  };

  const save = async () => {
    if (!draft) return null;
    setPending(true);
    const result = await saveWorkflowAction({
      ...draft,
      projectId: project.id,
    });
    setPending(false);
    if (!result.ok) {
      onNotice("error", result.error);
      return null;
    }
    setDraft({ ...draft, id: result.data.id });
    onNotice("success", "Workflow saved.");
    await loadList();
    onRefresh();
    return result.data.id;
  };

  const run = async () => {
    const workflowId = await save();
    if (!workflowId) return;
    setPending(true);
    setReport(null);
    try {
      const response = await fetch(`/api/workflows/${workflowId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflowRunId: crypto.randomUUID(),
          runtimeVariables: [],
        }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof payload === "object" &&
          payload !== null &&
          "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : "Workflow execution failed.";
        throw new Error(message);
      }
      const value = payload as WorkflowRunReport;
      setReport(value);
      onNotice(
        value.status === "succeeded" ? "success" : "error",
        value.status === "succeeded"
          ? "Workflow completed successfully."
          : `Workflow ${value.status}.`,
      );
      await loadList();
    } catch (error) {
      onNotice(
        "error",
        error instanceof Error ? error.message : "Workflow execution failed.",
      );
    } finally {
      setPending(false);
    }
  };

  const remove = async (workflow: WorkflowSummary) => {
    if (
      !window.confirm(`Delete ${workflow.name}? Run reports will be retained.`)
    ) {
      return;
    }
    setPending(true);
    const result = await deleteWorkflowAction({ workflowId: workflow.id });
    setPending(false);
    if (!result.ok) {
      onNotice("error", result.error);
      return;
    }
    if (draft?.id === workflow.id) setDraft(null);
    onNotice("success", "Workflow deleted. Run reports were retained.");
    await loadList();
  };

  const showLastRun = async (runId: string) => {
    setPending(true);
    const result = await getWorkflowRunReportAction({ workflowRunId: runId });
    setPending(false);
    if (!result.ok) onNotice("error", result.error);
    else setReport(result.data);
  };

  return (
    <main className="min-w-0 flex-1 overflow-auto bg-background p-5 sm:p-7">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            aria-label="Back"
            onClick={onClose}
            size="icon"
            variant="ghost"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
          </Button>
          <div>
            <h1 className="text-lg font-semibold">Workflows</h1>
            <p className="text-xs text-muted">
              Ordered request sequences for {project.name}
            </p>
          </div>
          <Button
            className="ml-auto"
            disabled={!project.requests.length || pending}
            onClick={() => {
              const request = project.requests[0];
              if (!request) return;
              setReport(null);
              setDraft({
                name: "New workflow",
                description: "",
                steps: [
                  {
                    requestId: request.id,
                    name: request.name,
                    failureMode: "stop",
                    enabled: true,
                    runtimeOverrides: [],
                    assertions: [],
                  },
                ],
              });
            }}
          >
            <Plus aria-hidden="true" className="size-4" /> New workflow
          </Button>
        </div>

        {!project.requests.length ? (
          <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted">
            Create at least one saved request before building a workflow.
          </p>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-[19rem_minmax(0,1fr)]">
          <aside className="space-y-2">
            {loading ? (
              <LoaderCircle
                aria-label="Loading workflows"
                className="mx-auto my-8 size-5 animate-spin text-accent"
              />
            ) : workflows.length ? (
              workflows.map((workflow) => (
                <article
                  className={cn(
                    "rounded-lg border bg-surface p-3",
                    draft?.id === workflow.id && "border-accent",
                  )}
                  key={workflow.id}
                >
                  <button
                    className="w-full text-left"
                    onClick={() => void edit(workflow.id)}
                    type="button"
                  >
                    <span className="font-medium">{workflow.name}</span>
                    <span className="mt-1 block text-[11px] text-muted">
                      {workflow.stepCount} step(s)
                    </span>
                  </button>
                  <div className="mt-2 flex items-center gap-2">
                    {workflow.lastRun ? (
                      <button
                        className={cn(
                          "font-mono text-[10px] uppercase",
                          statusClass(workflow.lastRun.status),
                        )}
                        onClick={() => void showLastRun(workflow.lastRun!.id)}
                        type="button"
                      >
                        Last run: {workflow.lastRun.status}
                      </button>
                    ) : (
                      <span className="text-[10px] text-muted">Never run</span>
                    )}
                    <Button
                      aria-label={`Delete ${workflow.name}`}
                      className="ml-auto"
                      onClick={() => void remove(workflow)}
                      size="icon"
                      variant="ghost"
                    >
                      <Trash2
                        aria-hidden="true"
                        className="size-3.5 text-red-500"
                      />
                    </Button>
                  </div>
                </article>
              ))
            ) : (
              <p className="rounded-lg border border-dashed p-6 text-center text-xs text-muted">
                No workflows yet.
              </p>
            )}
          </aside>

          <div className="min-w-0 space-y-4">
            {draft ? (
              <section className="space-y-5 rounded-xl border bg-surface p-4 sm:p-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1.5 text-xs font-medium">
                    Workflow name
                    <input
                      className="h-9 w-full rounded-md border bg-surface-subtle px-2.5"
                      onChange={(event) =>
                        setDraft({ ...draft, name: event.target.value })
                      }
                      value={draft.name}
                    />
                  </label>
                  <label className="space-y-1.5 text-xs font-medium">
                    Description
                    <input
                      className="h-9 w-full rounded-md border bg-surface-subtle px-2.5"
                      onChange={(event) =>
                        setDraft({ ...draft, description: event.target.value })
                      }
                      value={draft.description}
                    />
                  </label>
                </div>

                <div className="space-y-3">
                  {draft.steps.map((step, index) => (
                    <article
                      className="space-y-4 rounded-xl border bg-background p-4"
                      key={step.id ?? index}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="grid size-6 place-items-center rounded-full border font-mono text-[10px]">
                          {index + 1}
                        </span>
                        <input
                          aria-label={`Step ${index + 1} name`}
                          className="h-9 min-w-40 flex-1 rounded-md border bg-surface-subtle px-2.5 text-xs font-medium"
                          onChange={(event) =>
                            updateStep(index, { name: event.target.value })
                          }
                          value={step.name}
                        />
                        <Button
                          aria-label={`Move step ${index + 1} up`}
                          disabled={index === 0}
                          onClick={() => moveStep(index, -1)}
                          size="icon"
                          variant="ghost"
                        >
                          <ArrowUp aria-hidden="true" className="size-3.5" />
                        </Button>
                        <Button
                          aria-label={`Move step ${index + 1} down`}
                          disabled={index === draft.steps.length - 1}
                          onClick={() => moveStep(index, 1)}
                          size="icon"
                          variant="ghost"
                        >
                          <ArrowDown aria-hidden="true" className="size-3.5" />
                        </Button>
                        <Button
                          aria-label={`Delete step ${index + 1}`}
                          disabled={draft.steps.length === 1}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              steps: draft.steps.filter(
                                (_candidate, candidate) => candidate !== index,
                              ),
                            })
                          }
                          size="icon"
                          variant="ghost"
                        >
                          <Trash2
                            aria-hidden="true"
                            className="size-3.5 text-red-500"
                          />
                        </Button>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-[1fr_12rem_auto]">
                        <label className="space-y-1.5 text-xs font-medium">
                          Saved request
                          <select
                            className="h-9 w-full rounded-md border bg-surface-subtle px-2.5 text-xs"
                            onChange={(event) => {
                              const request = project.requests.find(
                                ({ id }) => id === event.target.value,
                              );
                              updateStep(index, {
                                requestId: event.target.value,
                                name: request?.name ?? step.name,
                              });
                            }}
                            value={step.requestId}
                          >
                            {project.requests.map((request) => (
                              <option key={request.id} value={request.id}>
                                {request.method} · {request.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="space-y-1.5 text-xs font-medium">
                          On failure
                          <select
                            className="h-9 w-full rounded-md border bg-surface-subtle px-2.5 text-xs"
                            onChange={(event) =>
                              updateStep(index, {
                                failureMode: event.target.value as
                                  "stop" | "continue",
                              })
                            }
                            value={step.failureMode}
                          >
                            <option value="stop">Stop workflow</option>
                            <option value="continue">Continue</option>
                          </select>
                        </label>
                        <label className="flex items-end gap-2 pb-2 text-xs">
                          <input
                            checked={step.enabled}
                            onChange={(event) =>
                              updateStep(index, {
                                enabled: event.target.checked,
                              })
                            }
                            type="checkbox"
                          />
                          Enabled
                        </label>
                      </div>
                      <details>
                        <summary className="cursor-pointer text-xs font-semibold">
                          Runtime overrides ({step.runtimeOverrides.length})
                        </summary>
                        <div className="mt-3">
                          <VariableRowsEditor
                            defaultSecret
                            emptyLabel="No step-specific runtime overrides."
                            onChange={(runtimeOverrides) =>
                              updateStep(index, { runtimeOverrides })
                            }
                            variables={step.runtimeOverrides}
                          />
                        </div>
                      </details>
                      <details open={step.assertions.length > 0}>
                        <summary className="cursor-pointer text-xs font-semibold">
                          Step assertions ({step.assertions.length})
                        </summary>
                        <div className="mt-3">
                          <AssertionEditor
                            assertions={step.assertions}
                            emptyLabel="No step-only assertions. Request assertions still run."
                            onChange={(assertions) =>
                              updateStep(index, { assertions })
                            }
                          />
                        </div>
                      </details>
                    </article>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    disabled={draft.steps.length >= 100}
                    onClick={() => {
                      const request = project.requests[0];
                      if (!request) return;
                      setDraft({
                        ...draft,
                        steps: [
                          ...draft.steps,
                          {
                            requestId: request.id,
                            name: request.name,
                            failureMode: "stop",
                            enabled: true,
                            runtimeOverrides: [],
                            assertions: [],
                          },
                        ],
                      });
                    }}
                    variant="secondary"
                  >
                    <Plus aria-hidden="true" className="size-4" /> Add step
                  </Button>
                  <Button
                    className="ml-auto"
                    disabled={pending}
                    onClick={() => void save()}
                    variant="secondary"
                  >
                    <Save aria-hidden="true" className="size-4" /> Save
                  </Button>
                  <Button disabled={pending} onClick={() => void run()}>
                    {pending ? (
                      <LoaderCircle
                        aria-hidden="true"
                        className="size-4 animate-spin"
                      />
                    ) : (
                      <Play aria-hidden="true" className="size-4" />
                    )}
                    Run workflow
                  </Button>
                </div>
              </section>
            ) : (
              <section className="grid min-h-72 place-items-center rounded-xl border border-dashed text-center">
                <div>
                  <Workflow
                    aria-hidden="true"
                    className="mx-auto size-7 text-accent"
                  />
                  <p className="mt-3 text-sm font-medium">
                    Select or create a workflow
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    Steps execute from top to bottom and can publish outputs for
                    the next request.
                  </p>
                </div>
              </section>
            )}
            {report ? <RunReport report={report} /> : null}
          </div>
        </div>
      </div>
    </main>
  );
}
