"use client";

import {
  Check,
  Cloud,
  Copy,
  ExternalLink,
  LoaderCircle,
  LogOut,
  X,
} from "lucide-react";
import { Dialog } from "radix-ui";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type { AzureConnectionState } from "@/features/authentication/azure/domain";
import { cn } from "@/lib/utils";

async function requestAzure(
  path: string,
  init?: RequestInit,
): Promise<AzureConnectionState> {
  const response = await fetch(path, { cache: "no-store", ...init });
  const payload = (await response.json()) as
    AzureConnectionState | { error: string };
  if (!response.ok || "error" in payload) {
    throw new Error(
      "error" in payload ? payload.error : "Azure operation failed.",
    );
  }
  return payload;
}

const jsonMutation = (method: "POST" | "DELETE", body: unknown = {}) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export function AzureConnection({
  onStateChange,
}: {
  onStateChange?: (state: AzureConnectionState | null) => void;
}) {
  const [state, setState] = useState<AzureConnectionState | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [tenant, setTenant] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    onStateChange?.(state);
  }, [onStateChange, state]);

  const load = useCallback(async () => {
    const next = await requestAzure("/api/configuration/azure");
    setState(next);
    return next;
  }, []);

  useEffect(() => {
    let active = true;
    requestAzure("/api/configuration/azure")
      .then((next) => {
        if (active) setState(next);
      })
      .catch((caught: unknown) => {
        if (active)
          setError(
            caught instanceof Error
              ? caught.message
              : "Azure connection could not be loaded.",
          );
      });
    return () => {
      active = false;
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [load]);

  useEffect(() => {
    if (
      !dialogOpen ||
      !state ||
      !["starting", "waiting"].includes(state.status)
    )
      return;
    let active = true;
    const poll = async () => {
      try {
        const next = await load();
        if (!active) return;
        if (next.status === "connected") {
          setDialogOpen(false);
          setError(null);
          return;
        }
        if (next.status === "starting" || next.status === "waiting") {
          pollTimer.current = setTimeout(() => void poll(), 1_250);
        }
      } catch (caught) {
        if (active)
          setError(
            caught instanceof Error
              ? caught.message
              : "Azure sign-in status could not be checked.",
          );
      }
    };
    pollTimer.current = setTimeout(() => void poll(), 500);
    return () => {
      active = false;
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [dialogOpen, load, state]);

  const connect = async () => {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const next = await requestAzure(
        "/api/configuration/azure/login",
        jsonMutation("POST", { tenant }),
      );
      setState(next);
      setDialogOpen(true);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Azure sign-in failed.",
      );
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      await requestAzure(
        "/api/configuration/azure/login",
        jsonMutation("DELETE"),
      );
      setDialogOpen(false);
      setState({ status: "disconnected", cliAvailable: true });
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Sign-in could not be cancelled.",
      );
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm("Disconnect the current Azure account?")) return;
    setBusy(true);
    setError(null);
    try {
      await requestAzure("/api/configuration/azure", jsonMutation("DELETE"));
      setState({ status: "disconnected", cliAvailable: true });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Azure could not be disconnected.",
      );
    } finally {
      setBusy(false);
    }
  };

  const waiting = state?.status === "starting" || state?.status === "waiting";
  const connected = state?.status === "connected" ? state.account : null;
  const stateError = state?.status === "failed" ? state.error : null;

  return (
    <>
      <section className="mt-5 rounded-xl border bg-surface p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span
              className={cn(
                "grid size-9 shrink-0 place-items-center rounded-lg",
                connected
                  ? "bg-success/10 text-success"
                  : "bg-accent/10 text-accent",
              )}
            >
              <Cloud aria-hidden="true" className="size-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">Azure connection</h2>
              {connected ? (
                <div className="mt-1 text-xs text-muted">
                  <p className="truncate text-foreground">
                    {connected.username}
                  </p>
                  <p className="truncate">
                    {connected.name} · tenant {connected.tenantId}
                  </p>
                </div>
              ) : (
                <p className="mt-1 text-xs text-muted">
                  Connect your Microsoft account to resolve authentication
                  secrets from Azure Key Vault.
                </p>
              )}
            </div>
          </div>
          {connected ? (
            <Button
              disabled={busy}
              onClick={() => void disconnect()}
              size="sm"
              variant="secondary"
            >
              <LogOut aria-hidden="true" className="size-3.5" /> Disconnect
            </Button>
          ) : (
            <Button
              disabled={busy || !state?.cliAvailable}
              onClick={() => setDialogOpen(true)}
              size="sm"
            >
              {busy ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="size-3.5 animate-spin"
                />
              ) : (
                <Cloud aria-hidden="true" className="size-3.5" />
              )}{" "}
              Connect Azure
            </Button>
          )}
        </div>
        {!state ? (
          <p className="mt-3 text-xs text-muted" role="status">
            Checking Azure connection…
          </p>
        ) : !state.cliAvailable ? (
          <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600">
            Azure CLI is unavailable. Use the standard Workbench Docker image
            with Azure support.
          </p>
        ) : null}
        {error || stateError ? (
          <p
            className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-500"
            role="alert"
          >
            {error ?? stateError}
          </p>
        ) : null}
      </section>

      <Dialog.Root
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open && waiting) void cancel();
          else setDialogOpen(open);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px]" />
          <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(92vw,32rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-surface p-5 text-foreground shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Dialog.Title className="text-base font-semibold">
                  Connect Microsoft Azure
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-xs leading-5 text-muted">
                  Sign in as yourself. Workbench never receives your Microsoft
                  password or exposes Azure tokens to the browser.
                </Dialog.Description>
              </div>
              {!waiting ? (
                <Dialog.Close asChild>
                  <Button
                    aria-label="Close Azure connection"
                    size="icon"
                    variant="ghost"
                  >
                    <X aria-hidden="true" className="size-4" />
                  </Button>
                </Dialog.Close>
              ) : null}
            </div>

            {!waiting ? (
              <div className="mt-5 space-y-4">
                {error || stateError ? (
                  <p
                    className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-500"
                    role="alert"
                  >
                    {error ?? stateError}
                  </p>
                ) : null}
                <label className="block space-y-1.5 text-xs font-medium">
                  Tenant ID or domain{" "}
                  <span className="font-normal text-muted">Optional</span>
                  <input
                    className="h-10 w-full rounded-md border bg-surface-subtle px-3 font-mono text-xs"
                    maxLength={255}
                    onChange={(event) => setTenant(event.target.value)}
                    placeholder="contoso.onmicrosoft.com"
                    value={tenant}
                  />
                </label>
                <div className="flex justify-end gap-2">
                  <Dialog.Close asChild>
                    <Button type="button" variant="secondary">
                      Cancel
                    </Button>
                  </Dialog.Close>
                  <Button disabled={busy} onClick={() => void connect()}>
                    {busy ? (
                      <LoaderCircle
                        aria-hidden="true"
                        className="size-4 animate-spin"
                      />
                    ) : null}
                    Start sign-in
                  </Button>
                </div>
              </div>
            ) : state?.status === "waiting" && state.userCode ? (
              <div className="mt-5 space-y-4" aria-live="polite">
                <div className="rounded-lg border bg-surface-subtle p-4 text-center">
                  <p className="text-xs text-muted">
                    Enter this temporary code
                  </p>
                  <p className="mt-2 font-mono text-2xl font-semibold tracking-[0.18em]">
                    {state.userCode}
                  </p>
                  <button
                    className="mt-2 inline-flex items-center gap-1 text-xs text-accent"
                    onClick={() => {
                      void navigator.clipboard.writeText(state.userCode ?? "");
                      setCopied(true);
                    }}
                    type="button"
                  >
                    {copied ? (
                      <Check className="size-3" />
                    ) : (
                      <Copy className="size-3" />
                    )}
                    {copied ? "Copied" : "Copy code"}
                  </button>
                </div>
                <Button
                  className="w-full"
                  onClick={() =>
                    window.open(
                      state.verificationUrl ??
                        "https://microsoft.com/devicelogin",
                      "_blank",
                      "noopener,noreferrer",
                    )
                  }
                >
                  Open Microsoft sign-in <ExternalLink className="size-3.5" />
                </Button>
                <p
                  className="flex items-center justify-center gap-2 text-xs text-muted"
                  role="status"
                >
                  <LoaderCircle className="size-3.5 animate-spin" /> Waiting for
                  Microsoft sign-in…
                </p>
                <Button
                  className="w-full"
                  disabled={busy}
                  onClick={() => void cancel()}
                  variant="secondary"
                >
                  Cancel sign-in
                </Button>
              </div>
            ) : (
              <div
                className="mt-8 flex items-center justify-center gap-2 text-xs text-muted"
                role="status"
              >
                <LoaderCircle className="size-4 animate-spin" /> Starting secure
                Microsoft sign-in…
              </div>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
