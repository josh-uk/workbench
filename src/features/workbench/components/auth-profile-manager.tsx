"use client";

import { ArrowLeft, LoaderCircle, Plus, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  deleteAuthProfileAction,
  saveAuthOverrideAction,
  saveAuthProfileAction,
} from "@/features/authentication/actions";
import {
  type AuthConfiguration,
  type AuthProfileConfiguration,
  type AuthProfileDetail,
  type AuthType,
  authTypes,
  defaultAuthConfiguration,
} from "@/features/authentication/domain";
import { cn } from "@/lib/utils";

type Draft = Omit<AuthProfileDetail, "inherited" | "overridden"> & {
  inherited: boolean;
  overridden: boolean;
};

function newDraft(workspaceId: string, projectId?: string): Draft {
  return {
    id: "",
    workspaceId: projectId ? null : workspaceId,
    projectId: projectId ?? null,
    tokenRequestId: null,
    name: "New authentication profile",
    type: "none",
    configuration: defaultAuthConfiguration(),
    inherited: false,
    overridden: false,
  };
}

async function fetchConfiguration(workspaceId: string, projectId?: string) {
  const query = new URLSearchParams({ workspaceId });
  if (projectId) query.set("projectId", projectId);
  const response = await fetch(`/api/configuration/auth?${query}`);
  const payload = (await response.json()) as
    AuthConfiguration | { error: string };
  if (!response.ok || "error" in payload) {
    throw new Error(
      "error" in payload
        ? payload.error
        : "Authentication configuration could not be loaded.",
    );
  }
  return payload;
}

const oauthTypes = new Set<AuthType>([
  "oauth2_client_credentials",
  "oauth2_password",
  "oauth2_refresh_token",
]);

function TextField({
  configuration,
  label,
  name,
  onChange,
  secret = false,
}: {
  configuration: AuthProfileConfiguration;
  label: string;
  name: keyof AuthProfileConfiguration;
  onChange: (configuration: AuthProfileConfiguration) => void;
  secret?: boolean;
}) {
  const value = configuration[name];
  if (typeof value !== "string") return null;
  return (
    <label className="space-y-1.5 text-xs font-medium">
      {label}
      <input
        className="h-9 w-full rounded-md border bg-surface-subtle px-2.5 font-mono text-xs"
        onChange={(event) =>
          onChange({ ...configuration, [name]: event.target.value })
        }
        type={secret ? "password" : "text"}
        value={value}
      />
    </label>
  );
}

export function AuthProfileManager({
  onClose,
  project,
  workspace,
}: {
  onClose: () => void;
  project?: { id: string; name: string };
  workspace: { id: string; name: string };
}) {
  const [configuration, setConfiguration] = useState<AuthConfiguration | null>(
    null,
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);

  const load = useCallback(async () => {
    const loaded = await fetchConfiguration(workspace.id, project?.id);
    setConfiguration(loaded);
    return loaded;
  }, [project?.id, workspace.id]);

  useEffect(() => {
    let active = true;
    fetchConfiguration(workspace.id, project?.id)
      .then((loaded) => {
        if (active) {
          setConfiguration(loaded);
          setDraft(loaded.profiles[0] ?? newDraft(workspace.id, project?.id));
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setNotice({
            tone: "error",
            text:
              error instanceof Error
                ? error.message
                : "Authentication profiles could not be loaded.",
          });
        }
      });
    return () => {
      active = false;
    };
  }, [project?.id, workspace.id]);

  const updateConfiguration = (value: AuthProfileConfiguration) =>
    setDraft((current) =>
      current ? { ...current, configuration: value } : current,
    );

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setNotice(null);
    const result =
      draft.inherited && project
        ? await saveAuthOverrideAction({
            authProfileId: draft.id,
            projectId: project.id,
            configuration: draft.configuration,
          })
        : await saveAuthProfileAction({
            id: draft.id || undefined,
            workspaceId: draft.workspaceId,
            projectId: draft.projectId,
            tokenRequestId: draft.tokenRequestId,
            name: draft.name,
            type: draft.type,
            configuration: draft.configuration,
          });
    if (!result.ok) {
      setNotice({ tone: "error", text: result.error });
      setBusy(false);
      return;
    }
    const loaded = await load();
    const selectedId = draft.id || result.data?.id;
    setDraft(
      loaded.profiles.find(({ id }) => id === selectedId) ??
        loaded.profiles[0] ??
        newDraft(workspace.id, project?.id),
    );
    setNotice({
      tone: "success",
      text: draft.inherited
        ? "Project override saved."
        : "Authentication profile saved.",
    });
    setBusy(false);
  };

  const remove = async () => {
    if (!draft?.id || draft.inherited) return;
    if (!window.confirm(`Delete ${draft.name}?`)) return;
    setBusy(true);
    const result = await deleteAuthProfileAction({ authProfileId: draft.id });
    if (!result.ok) {
      setNotice({ tone: "error", text: result.error });
      setBusy(false);
      return;
    }
    const loaded = await load();
    setDraft(loaded.profiles[0] ?? newDraft(workspace.id, project?.id));
    setNotice({ tone: "success", text: "Authentication profile deleted." });
    setBusy(false);
  };

  const config = draft?.configuration;
  const inherited = Boolean(draft?.inherited);

  return (
    <main className="min-w-0 flex-1 overflow-auto bg-background p-5 sm:p-7">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-start gap-3">
          <Button
            aria-label="Close authentication profiles"
            onClick={onClose}
            size="icon"
            variant="ghost"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
          </Button>
          <div>
            <p className="text-[10px] font-semibold tracking-[0.14em] text-muted uppercase">
              {project
                ? `${project.name} configuration`
                : "Workspace configuration"}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              Authentication profiles
            </h1>
            <p className="mt-1 text-sm text-muted">
              Reuse credentials, OAuth tokens, and outputs without exposing
              secret values in history.
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

        {!configuration || !draft || !config ? (
          <div className="grid min-h-64 place-items-center">
            <LoaderCircle
              aria-label="Loading authentication profiles"
              className="size-6 animate-spin text-accent"
            />
          </div>
        ) : (
          <div className="mt-6 grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
            <aside className="h-fit rounded-xl border bg-surface p-2 shadow-sm">
              {configuration.profiles.map((profile) => (
                <button
                  className={cn(
                    "mb-1 w-full rounded-lg px-3 py-2 text-left text-xs",
                    draft.id === profile.id
                      ? "bg-surface-strong font-medium"
                      : "text-muted",
                  )}
                  key={profile.id}
                  onClick={() => setDraft(profile)}
                  type="button"
                >
                  {profile.name}
                  <span className="mt-0.5 block text-[10px] font-normal text-muted">
                    {profile.type.replaceAll("_", " ")} ·{" "}
                    {profile.inherited
                      ? "workspace inherited"
                      : profile.projectId
                        ? "project"
                        : "workspace"}
                  </span>
                </button>
              ))}
              <button
                className="mt-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-accent"
                onClick={() => setDraft(newDraft(workspace.id, project?.id))}
                type="button"
              >
                <Plus aria-hidden="true" className="size-3.5" /> New profile
              </button>
            </aside>

            <section className="rounded-xl border bg-surface p-5 shadow-sm">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1.5 text-xs font-medium">
                  Name
                  <input
                    className="h-9 w-full rounded-md border bg-surface-subtle px-2.5 text-xs"
                    disabled={inherited}
                    onChange={(event) =>
                      setDraft({ ...draft, name: event.target.value })
                    }
                    value={draft.name}
                  />
                </label>
                <label className="space-y-1.5 text-xs font-medium">
                  Type
                  <select
                    className="h-9 w-full rounded-md border bg-surface-subtle px-2.5 text-xs"
                    disabled={inherited}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        type: event.target.value as AuthType,
                      })
                    }
                    value={draft.type}
                  >
                    {authTypes.map((type) => (
                      <option key={type} value={type}>
                        {type.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                </label>
                {!draft.id && project ? (
                  <label className="space-y-1.5 text-xs font-medium">
                    Scope
                    <select
                      className="h-9 w-full rounded-md border bg-surface-subtle px-2.5 text-xs"
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          workspaceId:
                            event.target.value === "workspace"
                              ? workspace.id
                              : null,
                          projectId:
                            event.target.value === "project"
                              ? project.id
                              : null,
                        })
                      }
                      value={draft.projectId ? "project" : "workspace"}
                    >
                      <option value="project">Project · {project.name}</option>
                      <option value="workspace">
                        Workspace · {workspace.name}
                      </option>
                    </select>
                  </label>
                ) : null}

                {draft.type === "bearer" ? (
                  <>
                    <TextField
                      configuration={config}
                      label="Bearer token"
                      name="token"
                      onChange={updateConfiguration}
                      secret
                    />
                    <TextField
                      configuration={config}
                      label="Token prefix"
                      name="tokenPrefix"
                      onChange={updateConfiguration}
                    />
                    <TextField
                      configuration={config}
                      label="Header name"
                      name="headerName"
                      onChange={updateConfiguration}
                    />
                  </>
                ) : null}
                {draft.type === "basic" ? (
                  <>
                    <TextField
                      configuration={config}
                      label="Username"
                      name="username"
                      onChange={updateConfiguration}
                    />
                    <TextField
                      configuration={config}
                      label="Password"
                      name="password"
                      onChange={updateConfiguration}
                      secret
                    />
                    <TextField
                      configuration={config}
                      label="Header name"
                      name="headerName"
                      onChange={updateConfiguration}
                    />
                  </>
                ) : null}
                {draft.type === "api_key_header" ||
                draft.type === "api_key_query" ? (
                  <>
                    <TextField
                      configuration={config}
                      label="API key"
                      name="key"
                      onChange={updateConfiguration}
                      secret
                    />
                    <TextField
                      configuration={config}
                      label={
                        draft.type === "api_key_header"
                          ? "Header name"
                          : "Query parameter name"
                      }
                      name={
                        draft.type === "api_key_header"
                          ? "headerName"
                          : "queryName"
                      }
                      onChange={updateConfiguration}
                    />
                  </>
                ) : null}

                {oauthTypes.has(draft.type) ? (
                  <>
                    <TextField
                      configuration={config}
                      label="Token URL"
                      name="tokenUrl"
                      onChange={updateConfiguration}
                    />
                    <TextField
                      configuration={config}
                      label="Client ID"
                      name="clientId"
                      onChange={updateConfiguration}
                    />
                    <TextField
                      configuration={config}
                      label="Client secret"
                      name="clientSecret"
                      onChange={updateConfiguration}
                      secret
                    />
                    <TextField
                      configuration={config}
                      label="Scope"
                      name="scope"
                      onChange={updateConfiguration}
                    />
                    <TextField
                      configuration={config}
                      label="Audience"
                      name="audience"
                      onChange={updateConfiguration}
                    />
                    {draft.type === "oauth2_password" ? (
                      <>
                        <TextField
                          configuration={config}
                          label="Username"
                          name="username"
                          onChange={updateConfiguration}
                        />
                        <TextField
                          configuration={config}
                          label="Password"
                          name="password"
                          onChange={updateConfiguration}
                          secret
                        />
                      </>
                    ) : null}
                    {draft.type === "oauth2_refresh_token" ? (
                      <TextField
                        configuration={config}
                        label="Refresh token"
                        name="refreshToken"
                        onChange={updateConfiguration}
                        secret
                      />
                    ) : null}
                    <TextField
                      configuration={config}
                      label="Access token JSONPath"
                      name="accessTokenJsonPath"
                      onChange={updateConfiguration}
                    />
                    <TextField
                      configuration={config}
                      label="Refresh token JSONPath"
                      name="refreshTokenJsonPath"
                      onChange={updateConfiguration}
                    />
                    <TextField
                      configuration={config}
                      label="Expiry seconds JSONPath"
                      name="expiresInJsonPath"
                      onChange={updateConfiguration}
                    />
                    <TextField
                      configuration={config}
                      label="Token type JSONPath"
                      name="tokenTypeJsonPath"
                      onChange={updateConfiguration}
                    />
                  </>
                ) : null}

                {draft.type === "request_derived" ? (
                  <>
                    <label className="space-y-1.5 text-xs font-medium">
                      Token request
                      <select
                        className="h-9 w-full rounded-md border bg-surface-subtle px-2.5 text-xs"
                        disabled={inherited}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            tokenRequestId: event.target.value || null,
                          })
                        }
                        value={draft.tokenRequestId ?? ""}
                      >
                        <option value="">Select a saved request</option>
                        {configuration.tokenRequests
                          .filter(
                            (request) =>
                              !draft.projectId ||
                              request.projectId === draft.projectId,
                          )
                          .map((request) => (
                            <option key={request.id} value={request.id}>
                              {request.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <TextField
                      configuration={config}
                      label="Output name"
                      name="outputName"
                      onChange={updateConfiguration}
                    />
                    <TextField
                      configuration={config}
                      label="Token prefix"
                      name="tokenPrefix"
                      onChange={updateConfiguration}
                    />
                  </>
                ) : null}

                {oauthTypes.has(draft.type) ||
                draft.type === "request_derived" ? (
                  <>
                    <label className="space-y-1.5 text-xs font-medium">
                      Injection target
                      <select
                        className="h-9 w-full rounded-md border bg-surface-subtle px-2.5 text-xs"
                        onChange={(event) =>
                          updateConfiguration({
                            ...config,
                            injectionTarget: event.target.value as
                              "header" | "query",
                          })
                        }
                        value={config.injectionTarget}
                      >
                        <option value="header">Header</option>
                        <option value="query">Query parameter</option>
                      </select>
                    </label>
                    <TextField
                      configuration={config}
                      label="Injection name"
                      name="injectionName"
                      onChange={updateConfiguration}
                    />
                    <label className="space-y-1.5 text-xs font-medium">
                      On authentication failure
                      <select
                        className="h-9 w-full rounded-md border bg-surface-subtle px-2.5 text-xs"
                        onChange={(event) =>
                          updateConfiguration({
                            ...config,
                            failureBehavior: event.target.value as
                              "stop" | "continue_without_auth",
                          })
                        }
                        value={config.failureBehavior}
                      >
                        <option value="stop">Stop request</option>
                        <option value="continue_without_auth">
                          Continue without auth
                        </option>
                      </select>
                    </label>
                  </>
                ) : null}
              </div>
              {inherited ? (
                <p className="mt-4 rounded-lg border border-accent/25 bg-accent/5 p-3 text-xs text-muted">
                  This workspace profile is inherited. Saving creates or updates
                  the selected project&apos;s configuration override; the shared
                  profile remains unchanged.
                </p>
              ) : null}
              <div className="mt-5 flex gap-2 border-t pt-4">
                <Button disabled={busy} onClick={() => void save()}>
                  {busy ? (
                    <LoaderCircle
                      aria-hidden="true"
                      className="size-4 animate-spin"
                    />
                  ) : (
                    <Save aria-hidden="true" className="size-4" />
                  )}{" "}
                  Save
                </Button>
                {draft.id && !inherited ? (
                  <Button
                    disabled={busy}
                    onClick={() => void remove()}
                    variant="destructive"
                  >
                    <Trash2 aria-hidden="true" className="size-4" /> Delete
                  </Button>
                ) : null}
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
