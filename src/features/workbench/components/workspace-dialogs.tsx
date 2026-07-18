"use client";

import {
  Copy,
  LayoutGrid,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { AlertDialog, Dialog, DropdownMenu } from "radix-ui";
import { type FormEvent, useMemo } from "react";

import { Button } from "@/components/ui/button";
import {
  duplicateWorkspaceAction,
  selectWorkspaceAction,
} from "@/features/workspaces/actions";
import {
  collectFolderIds,
  type FolderNode,
  type WorkbenchNavigation,
} from "@/features/workspaces/domain";
import { cn } from "@/lib/utils";

import { MenuContent, menuItemClass } from "./workbench-menu";
import type { DeleteState, EditorState, Mutation } from "./workspace-ui-types";

export function EntityEditorDialog({
  editor,
  folders,
  pending,
  setEditor,
  submit,
}: {
  editor: EditorState | null;
  folders: FolderNode[];
  pending: boolean;
  setEditor: (state: EditorState | null) => void;
  submit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const isFolder = editor?.kind.includes("folder");
  const isRelocate = editor?.kind === "relocate-folder";
  const title =
    editor?.kind === "create-workspace"
      ? "Create workspace"
      : editor?.kind === "edit-workspace"
        ? "Edit workspace"
        : editor?.kind === "create-project"
          ? "Create project"
          : editor?.kind === "edit-project"
            ? "Edit project"
            : editor?.kind === "create-folder"
              ? editor.parentId
                ? "Create subfolder"
                : "Create folder"
              : editor?.kind === "edit-folder"
                ? "Rename folder"
                : "Move folder";
  const flattened = useMemo(() => {
    const result: Array<{
      id: string;
      name: string;
      depth: number;
      descendants: string[];
    }> = [];
    const walk = (nodes: FolderNode[], depth: number) => {
      for (const node of nodes) {
        result.push({
          id: node.id,
          name: node.name,
          depth,
          descendants: collectFolderIds(node.children),
        });
        walk(node.children, depth + 1);
      }
    };
    walk(folders, 0);
    return result;
  }, [folders]);
  const currentFolder = isRelocate
    ? flattened.find(({ id }) => id === editor.id)
    : undefined;
  const excludedDestinations = new Set([
    ...(isRelocate ? [editor.id] : []),
    ...(currentFolder?.descendants ?? []),
  ]);

  return (
    <Dialog.Root
      open={Boolean(editor)}
      onOpenChange={(open) => !open && setEditor(null)}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(92vw,30rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-surface p-5 text-foreground shadow-2xl">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold">
                {title}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-xs leading-5 text-muted">
                {isRelocate
                  ? "Choose a new parent. Circular hierarchies are rejected."
                  : "Names are unique within their current scope."}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button aria-label="Close dialog" size="icon" variant="ghost">
                <X aria-hidden="true" className="size-4" />
              </Button>
            </Dialog.Close>
          </div>
          {editor ? (
            <form className="space-y-4" onSubmit={submit}>
              {isRelocate ? (
                <label className="block space-y-1.5 text-xs font-medium">
                  Destination
                  <select
                    className="h-10 w-full rounded-md border bg-surface-subtle px-3 text-sm"
                    onChange={(event) =>
                      setEditor({
                        ...editor,
                        parentId: event.target.value || null,
                      })
                    }
                    value={editor.parentId ?? ""}
                  >
                    <option value="">Project root</option>
                    {flattened
                      .filter(({ id }) => !excludedDestinations.has(id))
                      .map((folder) => (
                        <option key={folder.id} value={folder.id}>
                          {`${"— ".repeat(folder.depth)}${folder.name}`}
                        </option>
                      ))}
                  </select>
                </label>
              ) : (
                <>
                  <label className="block space-y-1.5 text-xs font-medium">
                    Name
                    <input
                      autoFocus
                      className="h-10 w-full rounded-md border bg-surface-subtle px-3 text-sm"
                      maxLength={120}
                      onChange={(event) =>
                        setEditor({ ...editor, name: event.target.value })
                      }
                      placeholder={isFolder ? "Reference data" : "Client APIs"}
                      required
                      value={editor.name}
                    />
                  </label>
                  {"description" in editor ? (
                    <label className="block space-y-1.5 text-xs font-medium">
                      Description{" "}
                      <span className="font-normal text-muted">Optional</span>
                      <textarea
                        className="min-h-24 w-full resize-y rounded-md border bg-surface-subtle p-3 text-sm"
                        maxLength={2_000}
                        onChange={(event) =>
                          setEditor({
                            ...editor,
                            description: event.target.value,
                          })
                        }
                        placeholder="What belongs here?"
                        value={editor.description}
                      />
                    </label>
                  ) : null}
                </>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <Dialog.Close asChild>
                  <Button disabled={pending} type="button" variant="secondary">
                    Cancel
                  </Button>
                </Dialog.Close>
                <Button disabled={pending} type="submit">
                  {pending ? "Saving…" : isRelocate ? "Move folder" : "Save"}
                </Button>
              </div>
            </form>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function WorkspaceManager({
  navigation,
  open,
  pending,
  runMutation,
  setDeleteState,
  setEditor,
  setOpen,
}: {
  navigation: WorkbenchNavigation;
  open: boolean;
  pending: boolean;
  runMutation: (mutation: Mutation, success: string) => void;
  setDeleteState: (state: DeleteState) => void;
  setEditor: (state: EditorState) => void;
  setOpen: (open: boolean) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-40 max-h-[80vh] w-[min(94vw,42rem)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border bg-surface p-5 text-foreground shadow-2xl">
          <div className="mb-5 flex items-start justify-between">
            <div>
              <Dialog.Title className="text-base font-semibold">
                Workspaces
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-muted">
                Switch, duplicate, rename, or remove local workspaces.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button
                aria-label="Close workspace manager"
                size="icon"
                variant="ghost"
              >
                <X aria-hidden="true" className="size-4" />
              </Button>
            </Dialog.Close>
          </div>
          <div className="space-y-2">
            {navigation.workspaces.map((workspace) => (
              <div
                className="flex items-center gap-3 rounded-lg border bg-surface-subtle p-3"
                key={workspace.id}
              >
                <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
                  <LayoutGrid aria-hidden="true" className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {workspace.name}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {workspace.projects.length} projects
                    {workspace.description ? ` · ${workspace.description}` : ""}
                  </p>
                </div>
                <Button
                  disabled={
                    pending || workspace.id === navigation.activeWorkspaceId
                  }
                  onClick={() =>
                    runMutation(
                      () =>
                        selectWorkspaceAction({ workspaceId: workspace.id }),
                      `Switched to ${workspace.name}.`,
                    )
                  }
                  size="sm"
                  variant="secondary"
                >
                  {workspace.id === navigation.activeWorkspaceId
                    ? "Active"
                    : "Open"}
                </Button>
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <Button
                      aria-label={`Workspace actions for ${workspace.name}`}
                      disabled={pending}
                      size="icon"
                      variant="ghost"
                    >
                      <MoreHorizontal aria-hidden="true" className="size-4" />
                    </Button>
                  </DropdownMenu.Trigger>
                  <MenuContent>
                    <DropdownMenu.Item
                      className={menuItemClass}
                      onSelect={() =>
                        setEditor({
                          kind: "edit-workspace",
                          id: workspace.id,
                          name: workspace.name,
                          description: workspace.description ?? "",
                        })
                      }
                    >
                      <Pencil aria-hidden="true" className="size-3.5" /> Rename
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      className={menuItemClass}
                      onSelect={() =>
                        runMutation(
                          () =>
                            duplicateWorkspaceAction({
                              workspaceId: workspace.id,
                            }),
                          `Duplicated ${workspace.name}.`,
                        )
                      }
                    >
                      <Copy aria-hidden="true" className="size-3.5" /> Duplicate
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      className={cn(menuItemClass, "text-red-500")}
                      onSelect={() =>
                        setDeleteState({
                          kind: "workspace",
                          id: workspace.id,
                          name: workspace.name,
                        })
                      }
                    >
                      <Trash2 aria-hidden="true" className="size-3.5" /> Delete
                    </DropdownMenu.Item>
                  </MenuContent>
                </DropdownMenu.Root>
              </div>
            ))}
          </div>
          <Button
            className="mt-4"
            onClick={() =>
              setEditor({ kind: "create-workspace", name: "", description: "" })
            }
          >
            <Plus aria-hidden="true" className="size-4" /> New workspace
          </Button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function DeleteDialog({
  pending,
  state,
  setState,
  submit,
}: {
  pending: boolean;
  state: DeleteState | null;
  setState: (state: DeleteState | null) => void;
  submit: () => void;
}) {
  return (
    <AlertDialog.Root
      open={Boolean(state)}
      onOpenChange={(open) => !open && setState(null)}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-[60] bg-black/60" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-[60] w-[min(92vw,28rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-surface p-5 text-foreground shadow-2xl">
          <AlertDialog.Title className="text-base font-semibold">
            Delete {state?.kind}?
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm leading-6 text-muted">
            {state?.kind === "folder"
              ? `“${state.name}” and its nested folders will be removed. Saved requests are moved to the project root.`
              : state?.kind === "request"
                ? `“${state.name}” will be removed. Its bounded execution history remains associated with the project.`
                : `“${state?.name}” and all of its contained data will be permanently removed.`}
          </AlertDialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button disabled={pending} variant="secondary">
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <Button disabled={pending} onClick={submit} variant="destructive">
              {pending ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
