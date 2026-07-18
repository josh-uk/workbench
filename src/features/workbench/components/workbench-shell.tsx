"use client";

import {
  Braces,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  CircleDot,
  Clock3,
  Code2,
  FileCode2,
  Folder,
  FolderOpen,
  History,
  Import,
  KeyRound,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  Plus,
  Search,
  Send,
  Settings2,
  Sun,
  Variable,
  Workflow,
  X,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const requestTabs = ["Params", "Headers  3", "Body", "Auth", "Tests"];
const responseTabs = ["Body", "Headers  8", "Cookies", "Timing"] as const;

const responseBody = `{
  "id": "fact_7f31ad",
  "fact": "Honey never spoils when stored correctly.",
  "category": "science",
  "source": {
    "name": "Workbench Mock API",
    "verified": true
  },
  "createdAt": "2026-07-18T09:42:11.441Z"
}`;

function MethodBadge({ method }: { method: string }) {
  const colour =
    method === "POST"
      ? "text-warning"
      : method === "PATCH"
        ? "text-[#b97af7]"
        : "text-success";

  return (
    <span className={cn("w-10 font-mono text-[10px] font-bold", colour)}>
      {method}
    </span>
  );
}

function RequestItem({ method, name }: { method: string; name: string }) {
  return (
    <button
      type="button"
      className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-surface-strong"
    >
      <MethodBadge method={method} />
      <span className="truncate">{name}</span>
    </button>
  );
}

function NavigationItem({
  icon: Icon,
  label,
}: {
  icon: typeof History;
  label: string;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted transition-colors hover:bg-surface-strong hover:text-foreground"
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {label}
    </button>
  );
}

function ProjectTree() {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center rounded-md bg-surface-strong px-2 py-1.5 text-xs font-medium">
        <ChevronDown aria-hidden="true" className="mr-1 size-3.5" />
        <FolderOpen aria-hidden="true" className="mr-2 size-3.5 text-accent" />
        Project A
        <MoreHorizontal
          aria-hidden="true"
          className="ml-auto size-3.5 text-muted"
        />
      </div>
      <div className="ml-3 border-l pl-2">
        <div className="flex items-center px-2 py-1.5 text-xs font-medium">
          <ChevronDown aria-hidden="true" className="mr-1 size-3.5" />
          <Folder aria-hidden="true" className="mr-2 size-3.5 text-muted" />
          Authentication
        </div>
        <div className="ml-4">
          <RequestItem method="POST" name="Generate OAuth token" />
        </div>
        <div className="flex items-center px-2 py-1.5 text-xs font-medium">
          <ChevronDown aria-hidden="true" className="mr-1 size-3.5" />
          <Folder aria-hidden="true" className="mr-2 size-3.5 text-muted" />
          Facts
        </div>
        <div className="ml-4 space-y-0.5">
          <RequestItem method="GET" name="Get fact" />
          <RequestItem method="POST" name="Search facts" />
          <RequestItem method="POST" name="Create fact" />
          <RequestItem method="PATCH" name="Update fact" />
        </div>
        <div className="flex items-center px-2 py-1.5 text-xs font-medium">
          <ChevronRight aria-hidden="true" className="mr-1 size-3.5" />
          <Folder aria-hidden="true" className="mr-2 size-3.5 text-muted" />
          Reference Data
        </div>
      </div>
      <div className="flex items-center rounded-md px-2 py-1.5 text-xs text-muted">
        <ChevronRight aria-hidden="true" className="mr-1 size-3.5" />
        <Folder aria-hidden="true" className="mr-2 size-3.5" />
        Project B
      </div>
      <div className="flex items-center rounded-md px-2 py-1.5 text-xs text-muted">
        <ChevronRight aria-hidden="true" className="mr-1 size-3.5" />
        <Folder aria-hidden="true" className="mr-2 size-3.5" />
        Project C
      </div>
    </div>
  );
}

function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r bg-surface-subtle lg:flex">
      <div className="flex h-11 items-center justify-between border-b px-3">
        <span className="text-[11px] font-semibold tracking-[0.12em] text-muted uppercase">
          Navigator
        </span>
        <div className="flex items-center gap-0.5">
          <Button aria-label="Create request" size="icon" variant="ghost">
            <Plus aria-hidden="true" className="size-3.5" />
          </Button>
          <Button aria-label="Collapse sidebar" size="icon" variant="ghost">
            <PanelLeftClose aria-hidden="true" className="size-3.5" />
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-auto px-2 py-3">
        <div className="mb-4 space-y-0.5">
          <NavigationItem icon={Variable} label="Workspace variables" />
          <NavigationItem icon={KeyRound} label="Authentication profiles" />
          <NavigationItem icon={Import} label="Imported definitions" />
          <NavigationItem icon={Workflow} label="Workflows" />
          <NavigationItem icon={History} label="Request history" />
        </div>
        <div className="mb-2 flex items-center justify-between px-2">
          <span className="text-[10px] font-semibold tracking-[0.12em] text-muted uppercase">
            Projects
          </span>
          <Plus aria-hidden="true" className="size-3.5 text-muted" />
        </div>
        <ProjectTree />
      </div>
      <div className="border-t p-2">
        <NavigationItem icon={Settings2} label="Settings" />
      </div>
    </aside>
  );
}

function Topbar({
  dark,
  onToggleTheme,
}: {
  dark: boolean;
  onToggleTheme: () => void;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-surface px-3 sm:px-4">
      <div className="flex min-w-fit items-center gap-2.5">
        <div className="grid size-7 place-items-center rounded-lg bg-accent font-mono text-xs font-bold text-accent-foreground shadow-sm">
          W
        </div>
        <span className="hidden text-sm font-semibold tracking-tight sm:inline">
          Workbench
        </span>
      </div>
      <div aria-hidden="true" className="h-5 border-l" />
      <button
        type="button"
        className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium hover:bg-surface-subtle"
      >
        <span className="size-1.5 rounded-full bg-accent" />
        <span className="max-w-24 truncate">Work</span>
        <ChevronsUpDown aria-hidden="true" className="size-3 text-muted" />
      </button>
      <div className="ml-auto hidden max-w-sm flex-1 md:block">
        <label className="sr-only" htmlFor="global-search">
          Search requests and projects
        </label>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="absolute top-2 left-2.5 size-3.5 text-muted"
          />
          <input
            id="global-search"
            className="h-8 w-full rounded-md border bg-surface-subtle pl-8 text-xs shadow-inner placeholder:text-muted"
            placeholder="Search requests and projects"
          />
          <kbd className="absolute top-1.5 right-2 rounded border px-1.5 py-0.5 font-sans text-[10px] text-muted">
            ⌘K
          </kbd>
        </div>
      </div>
      <button
        type="button"
        className="flex items-center gap-2 rounded-md border border-success/25 bg-success/10 px-2.5 py-1.5 text-xs font-medium text-success"
      >
        <CircleDot aria-hidden="true" className="size-3" />
        Local
      </button>
      <Button
        aria-label={dark ? "Use light theme" : "Use dark theme"}
        onClick={onToggleTheme}
        size="icon"
        variant="ghost"
      >
        {dark ? (
          <Sun aria-hidden="true" className="size-4" />
        ) : (
          <Moon aria-hidden="true" className="size-4" />
        )}
      </Button>
    </header>
  );
}

function RequestEditor() {
  return (
    <section className="flex min-h-0 flex-[1.05] flex-col border-b bg-surface xl:border-r xl:border-b-0">
      <div className="flex h-10 shrink-0 items-center border-b px-2">
        <div className="flex h-full items-center gap-2 border-x border-t bg-surface-subtle px-3 text-xs font-medium">
          <MethodBadge method="GET" />
          Get fact
          <span
            className="size-1.5 rounded-full bg-warning"
            aria-label="Unsaved changes"
          />
          <X aria-hidden="true" className="ml-2 size-3 text-muted" />
        </div>
        <Button aria-label="New request tab" size="icon" variant="ghost">
          <Plus aria-hidden="true" className="size-3.5" />
        </Button>
      </div>
      <div className="flex items-center gap-2 p-3">
        <label className="sr-only" htmlFor="request-method">
          HTTP method
        </label>
        <select
          id="request-method"
          defaultValue="GET"
          className="h-9 rounded-md border border-success/40 bg-success/10 px-2 font-mono text-xs font-bold text-success"
        >
          <option>GET</option>
          <option>POST</option>
          <option>PUT</option>
          <option>PATCH</option>
          <option>DELETE</option>
        </select>
        <label className="sr-only" htmlFor="request-url">
          Request URL
        </label>
        <div className="relative min-w-0 flex-1">
          <input
            id="request-url"
            defaultValue="{{baseUrl}}/facts/fact_7f31ad"
            className="h-9 w-full rounded-md border bg-code-background px-3 font-mono text-xs shadow-inner"
          />
          <span className="absolute top-2.5 right-2.5 text-[10px] text-muted">
            2 variables
          </span>
        </div>
        <Button>
          <Send aria-hidden="true" className="size-3.5" />
          Send
          <span className="ml-1 border-l border-accent-foreground/20 pl-2 text-[10px] opacity-70">
            ⌘↵
          </span>
        </Button>
      </div>
      <div className="flex h-9 shrink-0 items-end gap-1 border-b px-3">
        {requestTabs.map((tab) => (
          <button
            type="button"
            key={tab}
            className={cn(
              "h-9 border-b-2 border-transparent px-2 text-xs font-medium text-muted",
              tab === "Body" && "border-accent text-foreground",
            )}
          >
            {tab}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-10 shrink-0 items-center justify-between border-b px-4">
          <div className="flex items-center gap-2 text-xs font-medium">
            <Braces aria-hidden="true" className="size-3.5 text-accent" />
            JSON
            <ChevronDown aria-hidden="true" className="size-3 text-muted" />
          </div>
          <span className="font-mono text-[10px] text-muted">
            UTF-8 · 7 lines
          </span>
        </div>
        <div className="min-h-52 flex-1 overflow-auto bg-code-background p-4 font-mono text-xs leading-6">
          <div className="grid grid-cols-[1.5rem_1fr]">
            {["{", '  "category": "science",', '  "limit": 10', "}"].map(
              (line, index) => (
                <div className="contents" key={line}>
                  <span className="text-muted select-none">{index + 1}</span>
                  <code>{line}</code>
                </div>
              ),
            )}
          </div>
        </div>
      </div>
      <div className="flex h-8 shrink-0 items-center gap-4 border-t px-3 text-[10px] text-muted">
        <span>Environment: Local</span>
        <span>Timeout: 30s</span>
        <span className="ml-auto">Saved 1 min ago</span>
      </div>
    </section>
  );
}

function ResponseViewer() {
  const [activeTab, setActiveTab] =
    useState<(typeof responseTabs)[number]>("Body");

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-surface">
      <div className="flex h-11 shrink-0 items-center gap-3 border-b px-3">
        <span className="text-xs font-semibold">Response</span>
        <span className="rounded bg-success/10 px-2 py-1 font-mono text-[11px] font-bold text-success">
          200 OK
        </span>
        <span className="flex items-center gap-1 text-[11px] text-muted">
          <Clock3 aria-hidden="true" className="size-3" /> 128 ms
        </span>
        <span className="text-[11px] text-muted">1.2 KB</span>
        <Button className="ml-auto" size="sm" variant="ghost">
          <Code2 aria-hidden="true" className="size-3.5" /> Copy
        </Button>
      </div>
      <div className="flex h-9 shrink-0 items-end gap-1 border-b px-3">
        {responseTabs.map((tab) => (
          <button
            type="button"
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "h-9 border-b-2 border-transparent px-2 text-xs font-medium text-muted",
              activeTab === tab && "border-accent text-foreground",
            )}
          >
            {tab}
          </button>
        ))}
      </div>
      <div className="flex h-9 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2 text-xs font-medium">
          <FileCode2 aria-hidden="true" className="size-3.5 text-accent" />
          Pretty
          <span className="text-muted">JSON</span>
        </div>
        <span className="font-mono text-[10px] text-muted">
          application/json
        </span>
      </div>
      <div className="min-h-52 flex-1 overflow-auto bg-code-background p-4">
        {activeTab === "Body" ? (
          <pre className="font-mono text-xs leading-6 whitespace-pre-wrap">
            <code>{responseBody}</code>
          </pre>
        ) : (
          <div className="grid place-items-center py-20 text-sm text-muted">
            {activeTab} details will appear here.
          </div>
        )}
      </div>
      <div className="flex h-8 shrink-0 items-center border-t px-3 text-[10px] text-muted">
        <span className="mr-2 size-1.5 rounded-full bg-success" />
        Completed at 10:42:11
        <span className="ml-auto">Request #184</span>
      </div>
    </section>
  );
}

export function WorkbenchShell() {
  const [dark, setDark] = useState(true);

  return (
    <div
      data-theme={dark ? "dark" : "light"}
      className="flex h-dvh min-h-[620px] flex-col overflow-hidden bg-background text-foreground"
    >
      <Topbar dark={dark} onToggleTheme={() => setDark((value) => !value)} />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col xl:flex-row">
          <RequestEditor />
          <ResponseViewer />
        </main>
      </div>
    </div>
  );
}
