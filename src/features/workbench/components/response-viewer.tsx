"use client";

import { Check, Copy, Download, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import type { ExecutionDetail } from "@/features/requests/domain";
import { cn } from "@/lib/utils";

const responseTabs = [
  "Pretty",
  "Raw",
  "Headers",
  "Cookies",
  "Outputs",
  "Timing",
  "Request",
  "History",
] as const;

function isTextContent(contentType: string | null) {
  return Boolean(
    contentType &&
    (/^text\//i.test(contentType) ||
      /(json|xml|javascript|svg|x-www-form-urlencoded)/i.test(contentType)),
  );
}

function decodedBody(execution: ExecutionDetail) {
  const response = execution.response;
  if (!response?.bodyPreview) return "";
  return isTextContent(response.contentType)
    ? response.bodyPreview
    : `[base64 binary preview]\n${response.bodyPreview}`;
}

function prettyBody(execution: ExecutionDetail) {
  const body = execution.response?.bodyPreview ?? "";
  if (/json/i.test(execution.response?.contentType ?? "")) {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      return body;
    }
  }
  return decodedBody(execution);
}

export function ResponseViewer({
  execution,
  history,
  onSelectHistory,
}: {
  execution: ExecutionDetail | null;
  history: ExecutionDetail[];
  onSelectHistory: (execution: ExecutionDetail) => void;
}) {
  const [tab, setTab] = useState<(typeof responseTabs)[number]>("Pretty");
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);
  const body = useMemo(
    () => (execution ? prettyBody(execution) : ""),
    [execution],
  );
  const matchCount = query
    ? body.toLocaleLowerCase().split(query.toLocaleLowerCase()).length - 1
    : 0;

  if (!execution) {
    return (
      <section className="grid min-h-72 flex-1 place-items-center border-t bg-code-background p-8 text-center">
        <div>
          <p className="text-sm font-medium">No response yet</p>
          <p className="mt-1 text-xs text-muted">
            Save and send the request to inspect status, body, headers, cookies,
            and timing.
          </p>
        </div>
      </section>
    );
  }

  const response = execution.response;
  const statusTone =
    execution.status === "succeeded" && (response?.statusCode ?? 500) < 400
      ? "text-success"
      : execution.status === "cancelled"
        ? "text-warning"
        : "text-red-500";
  const copyBody = async () => {
    await navigator.clipboard.writeText(body);
    setCopied(true);
    setTimeout(() => setCopied(false), 1_500);
  };
  const downloadBody = () => {
    const blob = new Blob([body], {
      type: response?.contentType ?? "text/plain;charset=utf-8",
    });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `workbench-response-${execution.id}.txt`;
    anchor.click();
    URL.revokeObjectURL(href);
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col border-t bg-code-background">
      <div className="flex flex-wrap items-center gap-3 border-b bg-surface px-4 py-2.5">
        <span className={cn("font-mono text-xs font-bold", statusTone)}>
          {response
            ? `${response.statusCode} ${response.statusText}`
            : execution.status.toUpperCase()}
        </span>
        {response ? (
          <>
            <span className="font-mono text-[10px] text-muted">
              {response.durationMs} ms
            </span>
            <span className="font-mono text-[10px] text-muted">
              {response.sizeBytes?.toLocaleString()} bytes
            </span>
            {response.bodyTruncated ? (
              <span className="text-[10px] text-warning">
                Preview truncated
              </span>
            ) : null}
          </>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          <Button
            aria-label="Copy response"
            onClick={copyBody}
            size="icon"
            variant="ghost"
          >
            {copied ? (
              <Check aria-hidden="true" className="size-3.5 text-success" />
            ) : (
              <Copy aria-hidden="true" className="size-3.5" />
            )}
          </Button>
          <Button
            aria-label="Download response"
            onClick={downloadBody}
            size="icon"
            variant="ghost"
          >
            <Download aria-hidden="true" className="size-3.5" />
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center border-b bg-surface px-3">
        {responseTabs.map((item) => (
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
            {item === "History" ? ` ${history.length}` : ""}
          </button>
        ))}
        {(tab === "Pretty" || tab === "Raw") && response ? (
          <label className="relative my-1.5 ml-auto">
            <span className="sr-only">Search response</span>
            <Search
              aria-hidden="true"
              className="absolute top-2 left-2 size-3 text-muted"
            />
            <input
              className="h-7 w-44 rounded-md border bg-surface-subtle pr-8 pl-7 text-[11px]"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find in response"
              value={query}
            />
            {query ? (
              <span className="absolute top-1.5 right-2 font-mono text-[9px] text-muted">
                {matchCount}
              </span>
            ) : null}
          </label>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {execution.error ? (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-500">
            <p className="font-mono font-semibold">{execution.error.code}</p>
            <p className="mt-1">{execution.error.message}</p>
          </div>
        ) : null}
        {tab === "Pretty" && response ? (
          /^image\//i.test(response.contentType ?? "") ? (
            // The executor stores binary previews as base64 and response HTML never enters this path.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt="Response preview"
              className="max-h-96 max-w-full rounded border bg-white object-contain"
              src={`data:${response.contentType};base64,${response.bodyPreview}`}
            />
          ) : /^text\/html/i.test(response.contentType ?? "") ? (
            <iframe
              className="h-80 w-full rounded border bg-white"
              sandbox=""
              srcDoc={response.bodyPreview ?? ""}
              title="Sandboxed HTML response preview"
            />
          ) : (
            <pre className="font-mono text-xs leading-5 break-words whitespace-pre-wrap">
              {body}
            </pre>
          )
        ) : null}
        {tab === "Raw" ? (
          <pre className="font-mono text-xs leading-5 break-all whitespace-pre-wrap">
            {decodedBody(execution)}
          </pre>
        ) : null}
        {tab === "Headers" ? (
          <dl className="space-y-2 text-xs">
            {response?.headers.map((header, index) => (
              <div
                className="grid gap-2 sm:grid-cols-[14rem_1fr]"
                key={`${header.name}-${index}`}
              >
                <dt className="font-mono font-semibold">{header.name}</dt>
                <dd className="font-mono break-all text-muted">
                  {header.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        {tab === "Cookies" ? (
          response?.cookies.length ? (
            <div className="space-y-2">
              {response.cookies.map((cookie, index) => (
                <div
                  className="rounded-lg border bg-surface p-3 text-xs"
                  key={`${cookie.name}-${index}`}
                >
                  <span className="font-mono font-semibold">{cookie.name}</span>
                  <span className="ml-2 font-mono text-muted">
                    {cookie.value}
                  </span>
                  <p className="mt-1 text-[10px] text-muted">
                    {cookie.attributes.join(" · ")}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted">No response cookies.</p>
          )
        ) : null}
        {tab === "Outputs" ? (
          execution.outputs.length ? (
            <div className="space-y-2">
              {execution.outputs.map((output) => (
                <div
                  className="grid gap-2 rounded-lg border bg-surface p-3 text-xs sm:grid-cols-[12rem_1fr_auto]"
                  key={output.name}
                >
                  <span className="font-mono font-semibold">{output.name}</span>
                  <span className="font-mono break-all text-muted">
                    {output.value}
                  </span>
                  <span className="text-[10px] text-muted">
                    {output.expiresAt
                      ? `Expires ${new Date(output.expiresAt).toLocaleString()}`
                      : output.secret
                        ? "Secret · no expiry"
                        : "No expiry"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted">
              This execution did not publish outputs.
            </p>
          )
        ) : null}
        {tab === "Timing" ? (
          <dl className="grid max-w-md grid-cols-2 gap-3 text-xs">
            <dt className="text-muted">Started</dt>
            <dd>
              {execution.startedAt
                ? new Date(execution.startedAt).toLocaleString()
                : "—"}
            </dd>
            <dt className="text-muted">Completed</dt>
            <dd>
              {execution.completedAt
                ? new Date(execution.completedAt).toLocaleString()
                : "—"}
            </dd>
            <dt className="text-muted">Total</dt>
            <dd>{response?.durationMs ?? "—"} ms</dd>
            <dt className="text-muted">Redirects</dt>
            <dd>{response?.redirects.length ?? 0}</dd>
          </dl>
        ) : null}
        {tab === "Request" ? (
          <pre className="font-mono text-xs leading-5 break-all whitespace-pre-wrap">
            {JSON.stringify(execution.requestSnapshot, null, 2)}
          </pre>
        ) : null}
        {tab === "History" ? (
          <div className="space-y-2">
            {history.map((item) => (
              <button
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg border bg-surface px-3 py-2 text-left text-xs",
                  item.id === execution.id && "border-accent",
                )}
                key={item.id}
                onClick={() => onSelectHistory(item)}
                type="button"
              >
                <span className="w-16 font-mono font-semibold">
                  {item.method}
                </span>
                <span className="w-12 font-mono">
                  {item.response?.statusCode ?? item.status}
                </span>
                <span className="min-w-0 flex-1 truncate text-muted">
                  {item.resolvedUrl}
                </span>
                <time className="text-[10px] text-muted">
                  {new Date(item.createdAt).toLocaleString()}
                </time>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
