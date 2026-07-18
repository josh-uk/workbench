"use client";

import {
  Archive,
  Folder,
  FolderOpen,
  History,
  Import,
  KeyRound,
  LayoutGrid,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings2,
  Sun,
  Variable,
  Workflow,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";

import { Button } from "@/components/ui/button";
import {
  createFolderAction,
  createProjectAction,
  createWorkspaceAction,
  deleteFolderAction,
  deleteProjectAction,
  deleteWorkspaceAction,
  relocateFolderAction,
  updateFolderAction,
  updateProjectAction,
  updateWorkspaceAction,
} from "@/features/workspaces/actions";
import type { WorkbenchNavigation } from "@/features/workspaces/domain";
import { cn } from "@/lib/utils";

import { ProjectOverview } from "./project-overview";
import {
  DeleteDialog,
  EntityEditorDialog,
  WorkspaceManager,
} from "./workspace-dialogs";
import {
  folderMatchesQuery,
  FolderTree,
  NavigationItem,
  ProjectMenu,
  WorkspaceMenu,
} from "./workspace-navigation";
import type { DeleteState, EditorState, Mutation } from "./workspace-ui-types";

interface WorkbenchShellProps {
  navigation: WorkbenchNavigation;
}

export function WorkbenchShell({ navigation }: WorkbenchShellProps) {
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  const [dark, setDark] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [query, setQuery] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [deleteState, setDeleteState] = useState<DeleteState | null>(null);
  const [workspaceManagerOpen, setWorkspaceManagerOpen] = useState(false);
  const [notice, setNotice] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();

  const activeWorkspace =
    navigation.workspaces.find(
      ({ id }) => id === navigation.activeWorkspaceId,
    ) ?? navigation.workspaces[0];
  const normalisedQuery = query.toLocaleLowerCase();
  const visibleProjects = activeWorkspace?.projects.filter(
    (project) =>
      !normalisedQuery ||
      project.name.toLocaleLowerCase().includes(normalisedQuery) ||
      project.folders.some((folder) =>
        folderMatchesQuery(folder, normalisedQuery),
      ),
  );
  const activeProjects =
    visibleProjects?.filter(({ archived }) => !archived) ?? [];
  const archivedProjects =
    visibleProjects?.filter(({ archived }) => archived) ?? [];
  const selectedProject =
    activeWorkspace?.projects.find(
      ({ id, archived }) => id === selectedProjectId && !archived,
    ) ?? activeWorkspace?.projects.find(({ archived }) => !archived);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLocaleLowerCase() === "k"
      ) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const runMutation = (
    mutation: Mutation,
    success: string,
    after?: () => void,
  ) => {
    setNotice(null);
    startTransition(async () => {
      const result = await mutation();
      if (!result.ok) {
        setNotice({ tone: "error", text: result.error });
        return;
      }
      after?.();
      setNotice({ tone: "success", text: success });
      router.refresh();
    });
  };

  const submitEditor = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editor) return;

    const close = () => setEditor(null);
    switch (editor.kind) {
      case "create-workspace":
        runMutation(
          () => createWorkspaceAction(editor),
          "Workspace created.",
          close,
        );
        break;
      case "edit-workspace":
        runMutation(
          () => updateWorkspaceAction(editor),
          "Workspace updated.",
          close,
        );
        break;
      case "create-project":
        runMutation(
          () => createProjectAction(editor),
          "Project created.",
          close,
        );
        break;
      case "edit-project":
        runMutation(
          () => updateProjectAction(editor),
          "Project updated.",
          close,
        );
        break;
      case "create-folder":
        runMutation(() => createFolderAction(editor), "Folder created.", close);
        break;
      case "edit-folder":
        runMutation(() => updateFolderAction(editor), "Folder renamed.", close);
        break;
      case "relocate-folder":
        runMutation(
          () =>
            relocateFolderAction({
              folderId: editor.id,
              parentId: editor.parentId,
            }),
          "Folder moved.",
          close,
        );
        break;
    }
  };

  const confirmDelete = () => {
    if (!deleteState) return;
    const current = deleteState;
    const mutation =
      current.kind === "workspace"
        ? () => deleteWorkspaceAction({ workspaceId: current.id })
        : current.kind === "project"
          ? () => deleteProjectAction({ projectId: current.id })
          : () => deleteFolderAction({ folderId: current.id });
    runMutation(mutation, `${current.name} deleted.`, () =>
      setDeleteState(null),
    );
  };

  return (
    <div
      className="flex h-dvh min-h-[620px] flex-col overflow-hidden bg-background text-foreground"
      data-theme={dark ? "dark" : "light"}
    >
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
        <WorkspaceMenu
          activeWorkspace={activeWorkspace}
          navigation={navigation}
          onCreate={() =>
            setEditor({ kind: "create-workspace", name: "", description: "" })
          }
          onManage={() => setWorkspaceManagerOpen(true)}
          pending={pending}
          runMutation={runMutation}
        />
        {!sidebarOpen ? (
          <Button
            aria-label="Open sidebar"
            className="hidden lg:inline-flex"
            onClick={() => setSidebarOpen(true)}
            size="icon"
            variant="ghost"
          >
            <PanelLeftOpen aria-hidden="true" className="size-4" />
          </Button>
        ) : null}
        <div className="ml-auto hidden max-w-sm flex-1 md:block">
          <label className="sr-only" htmlFor="global-search">
            Search projects and folders
          </label>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="absolute top-2 left-2.5 size-3.5 text-muted"
            />
            <input
              className="h-8 w-full rounded-md border bg-surface-subtle pr-12 pl-8 text-xs shadow-inner placeholder:text-muted"
              id="global-search"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search projects and folders"
              ref={searchRef}
              value={query}
            />
            <kbd className="absolute top-1.5 right-2 rounded border px-1.5 py-0.5 font-sans text-[10px] text-muted">
              ⌘K
            </kbd>
          </div>
        </div>
        <span className="hidden items-center gap-2 rounded-md border border-success/25 bg-success/10 px-2.5 py-1.5 text-xs font-medium text-success sm:flex">
          <span className="size-1.5 rounded-full bg-success" /> Local
        </span>
        <Button
          aria-label={dark ? "Use light theme" : "Use dark theme"}
          onClick={() => setDark((value) => !value)}
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

      <div className="flex min-h-0 flex-1">
        <aside
          className={cn(
            "hidden w-72 shrink-0 flex-col border-r bg-surface-subtle lg:flex",
            !sidebarOpen && "lg:hidden",
          )}
        >
          <div className="flex h-11 items-center justify-between border-b px-3">
            <span className="text-[11px] font-semibold tracking-[0.12em] text-muted uppercase">
              Navigator
            </span>
            <Button
              aria-label="Collapse sidebar"
              onClick={() => setSidebarOpen(false)}
              size="icon"
              variant="ghost"
            >
              <PanelLeftClose aria-hidden="true" className="size-3.5" />
            </Button>
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
              <Button
                aria-label="Create project"
                disabled={!activeWorkspace || pending}
                onClick={() =>
                  activeWorkspace &&
                  setEditor({
                    kind: "create-project",
                    workspaceId: activeWorkspace.id,
                    name: "",
                    description: "",
                  })
                }
                size="icon"
                variant="ghost"
              >
                <Plus aria-hidden="true" className="size-3.5" />
              </Button>
            </div>
            {activeProjects.map((project) => {
              const selected = project.id === selectedProject?.id;
              return (
                <div className="mb-0.5" key={project.id}>
                  <div
                    className={cn(
                      "group flex items-center rounded-md",
                      selected && "bg-surface-strong text-foreground",
                    )}
                  >
                    <button
                      className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-xs font-medium"
                      onClick={() => setSelectedProjectId(project.id)}
                      type="button"
                    >
                      {selected ? (
                        <FolderOpen
                          aria-hidden="true"
                          className="size-3.5 shrink-0 text-accent"
                        />
                      ) : (
                        <Folder
                          aria-hidden="true"
                          className="size-3.5 shrink-0 text-muted"
                        />
                      )}
                      <span className="truncate">{project.name}</span>
                    </button>
                    <ProjectMenu
                      onDelete={() =>
                        setDeleteState({
                          kind: "project",
                          id: project.id,
                          name: project.name,
                        })
                      }
                      onEdit={() =>
                        setEditor({
                          kind: "edit-project",
                          id: project.id,
                          name: project.name,
                          description: project.description ?? "",
                        })
                      }
                      pending={pending}
                      project={project}
                      runMutation={runMutation}
                    />
                  </div>
                  {selected ? (
                    <div className="ml-3 border-l pl-1">
                      {project.folders.length ? (
                        <FolderTree
                          folders={project.folders}
                          pending={pending}
                          query={normalisedQuery}
                          runMutation={runMutation}
                          setDeleteState={setDeleteState}
                          setEditor={setEditor}
                        />
                      ) : (
                        <button
                          className="ml-2 flex items-center gap-2 px-2 py-2 text-[11px] text-muted hover:text-foreground"
                          onClick={() =>
                            setEditor({
                              kind: "create-folder",
                              projectId: project.id,
                              parentId: null,
                              name: "",
                            })
                          }
                          type="button"
                        >
                          <Plus aria-hidden="true" className="size-3" /> Add
                          first folder
                        </button>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {!activeWorkspace ? (
              <button
                className="w-full rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted hover:border-accent hover:text-foreground"
                onClick={() =>
                  setEditor({
                    kind: "create-workspace",
                    name: "",
                    description: "",
                  })
                }
                type="button"
              >
                <Plus aria-hidden="true" className="mx-auto mb-2 size-4" />{" "}
                Create a workspace
              </button>
            ) : activeProjects.length === 0 && !query ? (
              <p className="px-2 py-4 text-xs leading-5 text-muted">
                No active projects. Use + to create one.
              </p>
            ) : null}
            {archivedProjects.length ? (
              <div className="mt-5">
                <p className="mb-1 px-2 text-[10px] font-semibold tracking-wider text-muted uppercase">
                  Archived
                </p>
                {archivedProjects.map((project) => (
                  <div
                    className="group flex items-center rounded-md text-muted"
                    key={project.id}
                  >
                    <Archive aria-hidden="true" className="ml-2 size-3.5" />
                    <span className="min-w-0 flex-1 truncate px-2 py-1.5 text-xs">
                      {project.name}
                    </span>
                    <ProjectMenu
                      onDelete={() =>
                        setDeleteState({
                          kind: "project",
                          id: project.id,
                          name: project.name,
                        })
                      }
                      onEdit={() =>
                        setEditor({
                          kind: "edit-project",
                          id: project.id,
                          name: project.name,
                          description: project.description ?? "",
                        })
                      }
                      pending={pending}
                      project={project}
                      runMutation={runMutation}
                    />
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <div className="border-t p-2">
            <NavigationItem icon={Settings2} label="Settings" />
          </div>
        </aside>

        {activeWorkspace ? (
          <ProjectOverview project={selectedProject} setEditor={setEditor} />
        ) : (
          <main className="grid min-w-0 flex-1 place-items-center bg-background p-8 text-center">
            <div className="max-w-lg">
              <div className="mx-auto grid size-16 place-items-center rounded-2xl border bg-surface shadow-sm">
                <LayoutGrid aria-hidden="true" className="size-7 text-accent" />
              </div>
              <h1 className="mt-6 text-2xl font-semibold tracking-tight">
                Start with a workspace
              </h1>
              <p className="mt-2 text-sm leading-6 text-muted">
                Workspaces are broad areas such as Work, Personal, or a client.
                Everything remains on this installation.
              </p>
              <Button
                className="mt-5"
                onClick={() =>
                  setEditor({
                    kind: "create-workspace",
                    name: "",
                    description: "",
                  })
                }
              >
                <Plus aria-hidden="true" className="size-4" /> Create workspace
              </Button>
            </div>
          </main>
        )}
      </div>

      <EntityEditorDialog
        editor={editor}
        folders={selectedProject?.folders ?? []}
        pending={pending}
        setEditor={setEditor}
        submit={submitEditor}
      />
      <WorkspaceManager
        navigation={navigation}
        open={workspaceManagerOpen}
        pending={pending}
        runMutation={runMutation}
        setDeleteState={setDeleteState}
        setEditor={setEditor}
        setOpen={setWorkspaceManagerOpen}
      />
      <DeleteDialog
        pending={pending}
        setState={setDeleteState}
        state={deleteState}
        submit={confirmDelete}
      />
      {notice ? (
        <div
          aria-live="polite"
          className={cn(
            "fixed right-4 bottom-4 z-[70] max-w-sm rounded-lg border bg-surface px-4 py-3 text-sm shadow-xl",
            notice.tone === "error"
              ? "border-red-500/40 text-red-500"
              : "border-success/40 text-success",
          )}
          role="status"
        >
          {notice.text}
        </div>
      ) : null}
    </div>
  );
}
