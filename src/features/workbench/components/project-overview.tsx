"use client";

import {
  Database,
  Folder,
  FolderOpen,
  History,
  Network,
  Plus,
  Send,
  Variable,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  collectFolderIds,
  type ProjectNavigation,
} from "@/features/workspaces/domain";

import type { EditorState } from "./workspace-ui-types";

export function ProjectOverview({
  project,
  setEditor,
  onCreateRequest,
  onManageVariables,
}: {
  project: ProjectNavigation | undefined;
  setEditor: (state: EditorState) => void;
  onCreateRequest: (projectId: string, folderId: string | null) => void;
  onManageVariables: (project: { id: string; name: string }) => void;
}) {
  if (!project) {
    return (
      <div className="grid h-full place-items-center p-8">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl border bg-surface-subtle text-accent shadow-sm">
            <Network aria-hidden="true" className="size-6" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">
            Create your first project
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted">
            Projects keep folders, requests, environments, imports, and history
            together without depending on a Git repository.
          </p>
        </div>
      </div>
    );
  }

  const folderIds = collectFolderIds(project.folders);

  return (
    <main className="min-w-0 flex-1 overflow-auto bg-background p-5 sm:p-7">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold tracking-[0.14em] text-muted uppercase">
              <span className="size-1.5 rounded-full bg-accent" /> Project
              overview
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {project.name}
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
              {project.description ||
                "Add a description to explain what belongs in this project."}
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => onCreateRequest(project.id, null)}>
              <Send aria-hidden="true" className="size-4" /> New request
            </Button>
            <Button
              onClick={() =>
                setEditor({
                  kind: "create-folder",
                  projectId: project.id,
                  parentId: null,
                  name: "",
                })
              }
              variant="secondary"
            >
              <Plus aria-hidden="true" className="size-4" /> New folder
            </Button>
            <Button
              onClick={() => onManageVariables(project)}
              variant="secondary"
            >
              <Variable aria-hidden="true" className="size-4" /> Variables
            </Button>
          </div>
        </div>

        <div className="mt-7 grid gap-3 sm:grid-cols-3">
          {[
            { icon: FolderOpen, label: "Folders", value: folderIds.length },
            {
              icon: Database,
              label: "Saved requests",
              value: project.requestCount,
            },
            {
              icon: History,
              label: "Executions",
              value: project.executionCount,
            },
          ].map(({ icon: Icon, label, value }) => (
            <div
              className="rounded-xl border bg-surface p-4 shadow-sm"
              key={label}
            >
              <div className="flex items-center justify-between text-muted">
                <span className="text-xs font-medium">{label}</span>
                <Icon aria-hidden="true" className="size-4" />
              </div>
              <p className="mt-3 font-mono text-2xl font-semibold">{value}</p>
            </div>
          ))}
        </div>

        <section className="mt-6 rounded-xl border bg-surface shadow-sm">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold">Project structure</h2>
              <p className="mt-0.5 text-xs text-muted">
                Nested folders are persisted in PostgreSQL.
              </p>
            </div>
            <span className="rounded-full border bg-surface-subtle px-2.5 py-1 font-mono text-[10px] text-muted">
              {folderIds.length} total
            </span>
          </div>
          {project.folders.length ? (
            <div className="p-4">
              {project.folders.map((folder) => (
                <div
                  className="mb-2 flex items-center gap-3 rounded-lg border bg-surface-subtle px-3 py-2.5 last:mb-0"
                  key={folder.id}
                >
                  <FolderOpen
                    aria-hidden="true"
                    className="size-4 text-accent"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {folder.name}
                    </p>
                    <p className="text-[11px] text-muted">
                      {collectFolderIds(folder.children).length} nested folders
                      · {folder.requestCount ?? 0} requests
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid place-items-center px-6 py-14 text-center">
              <div>
                <Folder
                  aria-hidden="true"
                  className="mx-auto size-7 text-muted"
                />
                <p className="mt-3 text-sm font-medium">No folders yet</p>
                <p className="mt-1 text-xs text-muted">
                  Create a folder to organise saved requests.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
