"use client";

import {
  Archive,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Copy,
  Folder,
  FolderInput,
  History,
  MoreHorizontal,
  Pencil,
  Plus,
  Settings2,
  Trash2,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  archiveProjectAction,
  duplicateProjectAction,
  moveFolderAction,
  moveProjectAction,
  restoreProjectAction,
  selectWorkspaceAction,
} from "@/features/workspaces/actions";
import type {
  FolderNode,
  ProjectNavigation,
  WorkbenchNavigation,
  WorkspaceNavigation,
} from "@/features/workspaces/domain";
import type { SavedRequestSummary } from "@/features/requests/domain";
import { cn } from "@/lib/utils";

import type { DeleteState, EditorState, Mutation } from "./workspace-ui-types";
import { RequestNavigationItem } from "./request-navigation";
import { MenuContent, menuItemClass } from "./workbench-menu";

export function NavigationItem({
  active = false,
  icon: Icon,
  label,
  onClick,
}: {
  active?: boolean;
  icon: typeof History;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted transition-colors hover:bg-surface-strong hover:text-foreground",
        active && "bg-surface-strong text-foreground",
      )}
      onClick={onClick}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {label}
    </button>
  );
}

export function folderMatchesQuery(
  folder: FolderNode,
  query: string,
  requests: SavedRequestSummary[] = [],
): boolean {
  return (
    folder.name.toLocaleLowerCase().includes(query) ||
    requests.some(
      (request) =>
        request.folderId === folder.id &&
        request.name.toLocaleLowerCase().includes(query),
    ) ||
    folder.children.some((child) => folderMatchesQuery(child, query, requests))
  );
}

export function ProjectMenu({
  project,
  pending,
  onDelete,
  onEdit,
  runMutation,
}: {
  project: ProjectNavigation;
  pending: boolean;
  onDelete: () => void;
  onEdit: () => void;
  runMutation: (mutation: Mutation, success: string) => void;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button
          aria-label={`Project actions for ${project.name}`}
          className="size-6 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
          disabled={pending}
          size="icon"
          variant="ghost"
        >
          <MoreHorizontal aria-hidden="true" className="size-3.5" />
        </Button>
      </DropdownMenu.Trigger>
      <MenuContent>
        <DropdownMenu.Item className={menuItemClass} onSelect={onEdit}>
          <Pencil aria-hidden="true" className="size-3.5" /> Rename
        </DropdownMenu.Item>
        <DropdownMenu.Item
          className={menuItemClass}
          onSelect={() =>
            runMutation(
              () => duplicateProjectAction({ projectId: project.id }),
              `Duplicated ${project.name}.`,
            )
          }
        >
          <Copy aria-hidden="true" className="size-3.5" /> Duplicate
        </DropdownMenu.Item>
        <DropdownMenu.Item
          className={menuItemClass}
          onSelect={() =>
            runMutation(
              () =>
                moveProjectAction({ projectId: project.id, direction: "up" }),
              `Moved ${project.name} up.`,
            )
          }
        >
          <ArrowUp aria-hidden="true" className="size-3.5" /> Move up
        </DropdownMenu.Item>
        <DropdownMenu.Item
          className={menuItemClass}
          onSelect={() =>
            runMutation(
              () =>
                moveProjectAction({ projectId: project.id, direction: "down" }),
              `Moved ${project.name} down.`,
            )
          }
        >
          <ArrowDown aria-hidden="true" className="size-3.5" /> Move down
        </DropdownMenu.Item>
        <DropdownMenu.Separator className="my-1 border-t" />
        <DropdownMenu.Item
          className={menuItemClass}
          onSelect={() =>
            runMutation(
              () =>
                project.archived
                  ? restoreProjectAction({ projectId: project.id })
                  : archiveProjectAction({ projectId: project.id }),
              project.archived
                ? `Restored ${project.name}.`
                : `Archived ${project.name}.`,
            )
          }
        >
          <Archive aria-hidden="true" className="size-3.5" />
          {project.archived ? "Restore" : "Archive"}
        </DropdownMenu.Item>
        <DropdownMenu.Item
          className={cn(menuItemClass, "text-red-500")}
          onSelect={onDelete}
        >
          <Trash2 aria-hidden="true" className="size-3.5" /> Delete
        </DropdownMenu.Item>
      </MenuContent>
    </DropdownMenu.Root>
  );
}

function FolderMenu({
  folder,
  pending,
  setDeleteState,
  setEditor,
  runMutation,
  onCreateRequest,
}: {
  folder: FolderNode;
  pending: boolean;
  setDeleteState: (state: DeleteState) => void;
  setEditor: (state: EditorState) => void;
  runMutation: (mutation: Mutation, success: string) => void;
  onCreateRequest: (projectId: string, folderId: string) => void;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button
          aria-label={`Folder actions for ${folder.name}`}
          className="size-6 opacity-0 group-hover/folder:opacity-100 data-[state=open]:opacity-100"
          disabled={pending}
          size="icon"
          variant="ghost"
        >
          <MoreHorizontal aria-hidden="true" className="size-3.5" />
        </Button>
      </DropdownMenu.Trigger>
      <MenuContent>
        <DropdownMenu.Item
          className={menuItemClass}
          onSelect={() => onCreateRequest(folder.projectId, folder.id)}
        >
          <Plus aria-hidden="true" className="size-3.5" /> New request
        </DropdownMenu.Item>
        <DropdownMenu.Item
          className={menuItemClass}
          onSelect={() =>
            setEditor({
              kind: "create-folder",
              projectId: folder.projectId,
              parentId: folder.id,
              name: "",
            })
          }
        >
          <FolderInput aria-hidden="true" className="size-3.5" /> New subfolder
        </DropdownMenu.Item>
        <DropdownMenu.Item
          className={menuItemClass}
          onSelect={() =>
            setEditor({ kind: "edit-folder", id: folder.id, name: folder.name })
          }
        >
          <Pencil aria-hidden="true" className="size-3.5" /> Rename
        </DropdownMenu.Item>
        <DropdownMenu.Item
          className={menuItemClass}
          onSelect={() =>
            setEditor({
              kind: "relocate-folder",
              id: folder.id,
              name: folder.name,
              parentId: folder.parentId,
            })
          }
        >
          <FolderInput aria-hidden="true" className="size-3.5" /> Move to…
        </DropdownMenu.Item>
        <DropdownMenu.Item
          className={menuItemClass}
          onSelect={() =>
            runMutation(
              () => moveFolderAction({ folderId: folder.id, direction: "up" }),
              `Moved ${folder.name} up.`,
            )
          }
        >
          <ArrowUp aria-hidden="true" className="size-3.5" /> Move up
        </DropdownMenu.Item>
        <DropdownMenu.Item
          className={menuItemClass}
          onSelect={() =>
            runMutation(
              () =>
                moveFolderAction({ folderId: folder.id, direction: "down" }),
              `Moved ${folder.name} down.`,
            )
          }
        >
          <ArrowDown aria-hidden="true" className="size-3.5" /> Move down
        </DropdownMenu.Item>
        <DropdownMenu.Separator className="my-1 border-t" />
        <DropdownMenu.Item
          className={cn(menuItemClass, "text-red-500")}
          onSelect={() =>
            setDeleteState({ kind: "folder", id: folder.id, name: folder.name })
          }
        >
          <Trash2 aria-hidden="true" className="size-3.5" /> Delete
        </DropdownMenu.Item>
      </MenuContent>
    </DropdownMenu.Root>
  );
}

export function FolderTree({
  folders,
  pending,
  query,
  runMutation,
  setDeleteState,
  setEditor,
  requests,
  selectedRequestId,
  setSelectedRequestId,
  onCreateRequest,
  depth = 0,
}: {
  folders: FolderNode[];
  pending: boolean;
  query: string;
  runMutation: (mutation: Mutation, success: string) => void;
  setDeleteState: (state: DeleteState) => void;
  setEditor: (state: EditorState) => void;
  requests: SavedRequestSummary[];
  selectedRequestId: string | null;
  setSelectedRequestId: (id: string) => void;
  onCreateRequest: (projectId: string, folderId: string) => void;
  depth?: number;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const visibleFolders = folders.filter(
    (folder) => !query || folderMatchesQuery(folder, query, requests),
  );

  return visibleFolders.map((folder) => {
    const isCollapsed = collapsed.has(folder.id) && !query;
    const hasChildren = folder.children.length > 0;
    const hasRequests = requests.some(
      (request) => request.folderId === folder.id,
    );
    const hasContent = hasChildren || hasRequests;

    return (
      <div key={folder.id}>
        <div
          className="group/folder flex items-center rounded-md pr-1 text-xs text-muted hover:bg-surface-strong hover:text-foreground"
          style={{ paddingLeft: `${Math.min(depth, 6) * 12 + 4}px` }}
        >
          <button
            aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${folder.name}`}
            className={cn(
              "grid size-6 place-items-center",
              !hasContent && "invisible",
            )}
            onClick={() =>
              setCollapsed((current) => {
                const next = new Set(current);
                if (next.has(folder.id)) next.delete(folder.id);
                else next.add(folder.id);
                return next;
              })
            }
            type="button"
          >
            {isCollapsed ? (
              <ChevronRight aria-hidden="true" className="size-3" />
            ) : (
              <ChevronDown aria-hidden="true" className="size-3" />
            )}
          </button>
          <Folder aria-hidden="true" className="mr-2 size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate py-1.5">{folder.name}</span>
          {folder.requestCount ? (
            <span className="mr-1 font-mono text-[0.625rem]">
              {folder.requestCount}
            </span>
          ) : null}
          <FolderMenu
            folder={folder}
            pending={pending}
            runMutation={runMutation}
            setDeleteState={setDeleteState}
            setEditor={setEditor}
            onCreateRequest={onCreateRequest}
          />
        </div>
        {!isCollapsed ? (
          <div style={{ paddingLeft: `${Math.min(depth, 6) * 12 + 30}px` }}>
            {requests
              .filter(
                (request) =>
                  request.folderId === folder.id &&
                  (!query || request.name.toLocaleLowerCase().includes(query)),
              )
              .map((request) => (
                <RequestNavigationItem
                  key={request.id}
                  pending={pending}
                  request={request}
                  runMutation={runMutation}
                  selected={request.id === selectedRequestId}
                  setDeleteState={setDeleteState}
                  setSelectedRequestId={setSelectedRequestId}
                />
              ))}
          </div>
        ) : null}
        {!isCollapsed && hasChildren ? (
          <FolderTree
            depth={depth + 1}
            folders={folder.children}
            pending={pending}
            query={query}
            runMutation={runMutation}
            setDeleteState={setDeleteState}
            setEditor={setEditor}
            requests={requests}
            selectedRequestId={selectedRequestId}
            setSelectedRequestId={setSelectedRequestId}
            onCreateRequest={onCreateRequest}
          />
        ) : null}
      </div>
    );
  });
}

export function WorkspaceMenu({
  activeWorkspace,
  navigation,
  pending,
  onCreate,
  onManage,
  runMutation,
}: {
  activeWorkspace: WorkspaceNavigation | undefined;
  navigation: WorkbenchNavigation;
  pending: boolean;
  onCreate: () => void;
  onManage: () => void;
  runMutation: (mutation: Mutation, success: string) => void;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          aria-label="Select workspace"
          className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium hover:bg-surface-subtle"
          disabled={pending}
          type="button"
        >
          <span className="size-1.5 rounded-full bg-accent" />
          <span className="max-w-32 truncate">
            {activeWorkspace?.name ?? "Choose workspace"}
          </span>
          <ChevronsUpDown aria-hidden="true" className="size-3 text-muted" />
        </button>
      </DropdownMenu.Trigger>
      <MenuContent>
        <DropdownMenu.Label className="px-2 py-1 text-[0.625rem] font-semibold tracking-wider text-muted uppercase">
          Workspaces
        </DropdownMenu.Label>
        {navigation.workspaces.map((workspace) => (
          <DropdownMenu.Item
            className={menuItemClass}
            key={workspace.id}
            onSelect={() =>
              runMutation(
                () => selectWorkspaceAction({ workspaceId: workspace.id }),
                `Switched to ${workspace.name}.`,
              )
            }
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                workspace.id === activeWorkspace?.id
                  ? "bg-accent"
                  : "bg-border",
              )}
            />
            <span className="truncate">{workspace.name}</span>
          </DropdownMenu.Item>
        ))}
        <DropdownMenu.Separator className="my-1 border-t" />
        <DropdownMenu.Item className={menuItemClass} onSelect={onCreate}>
          <Plus aria-hidden="true" className="size-3.5" /> New workspace
        </DropdownMenu.Item>
        <DropdownMenu.Item className={menuItemClass} onSelect={onManage}>
          <Settings2 aria-hidden="true" className="size-3.5" /> Manage
          workspaces
        </DropdownMenu.Item>
      </MenuContent>
    </DropdownMenu.Root>
  );
}
