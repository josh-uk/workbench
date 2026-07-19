"use client";

import {
  Archive,
  Command,
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
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";

import { Button } from "@/components/ui/button";
import {
  createSavedRequestAction,
  deleteSavedRequestAction,
} from "@/features/requests/actions";
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
import { CollectionImportManager } from "./collection-import-manager";
import { OpenApiManager } from "./openapi-manager";
import { RequestEditor } from "./request-editor";
import { RequestNavigationItem } from "./request-navigation";
import { AuthProfileManager } from "./auth-profile-manager";
import { BackupManager } from "./backup-manager";
import { CommandPalette, type CommandPaletteAction } from "./command-palette";
import { VariableManager } from "./variable-manager";
import { WorkflowManager } from "./workflow-manager";
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

const THEME_STORAGE_KEY = "workbench.theme";
const THEME_CHANGE_EVENT = "workbench-theme-change";
type Theme = "dark" | "light";
let memoryTheme: Theme = "dark";

function savedTheme() {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    memoryTheme = value === "dark" || value === "light" ? value : "dark";
  } catch {
    // Fall back to the current in-memory selection.
  }
  return memoryTheme;
}

function saveTheme(theme: Theme) {
  memoryTheme = theme;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Theme selection still works when browser storage is unavailable.
  }
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

function subscribeToTheme(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
  };
}

export function WorkbenchShell({ navigation }: WorkbenchShellProps) {
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  const theme = useSyncExternalStore(
    subscribeToTheme,
    savedTheme,
    () => "dark" as const,
  );
  const dark = theme === "dark";
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(
    null,
  );
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [deleteState, setDeleteState] = useState<DeleteState | null>(null);
  const [workspaceManagerOpen, setWorkspaceManagerOpen] = useState(false);
  const [configurationView, setConfigurationView] = useState<{
    kind:
      | "variables"
      | "auth"
      | "imports"
      | "collection_imports"
      | "workflows"
      | "settings";
    projectId?: string;
  } | null>(null);
  const [notice, setNotice] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();

  const toggleTheme = useCallback(() => {
    saveTheme(dark ? "light" : "dark");
  }, [dark]);

  const activeWorkspace =
    navigation.workspaces.find(
      ({ id }) => id === navigation.activeWorkspaceId,
    ) ?? navigation.workspaces[0];
  const deferredQuery = useDeferredValue(query);
  const normalisedQuery = deferredQuery.trim().toLocaleLowerCase();
  const visibleProjects = activeWorkspace?.projects.filter(
    (project) =>
      !normalisedQuery ||
      project.name.toLocaleLowerCase().includes(normalisedQuery) ||
      project.requests.some((request) =>
        request.name.toLocaleLowerCase().includes(normalisedQuery),
      ) ||
      project.folders.some((folder) =>
        folderMatchesQuery(folder, normalisedQuery, project.requests),
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
  const activeRequestId = selectedProject?.requests.some(
    ({ id }) => id === selectedRequestId,
  )
    ? selectedRequestId
    : null;

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
          : current.kind === "folder"
            ? () => deleteFolderAction({ folderId: current.id })
            : () => deleteSavedRequestAction({ requestId: current.id });
    runMutation(mutation, `${current.name} deleted.`, () => {
      if (current.kind === "request" && selectedRequestId === current.id) {
        setSelectedRequestId(null);
      }
      setDeleteState(null);
    });
  };

  const createRequest = useCallback(
    (projectId: string, folderId: string | null) => {
      setNotice(null);
      startTransition(async () => {
        const result = await createSavedRequestAction({
          projectId,
          folderId,
          name: "New request",
          method: "GET",
          url: "https://example.com",
        });
        if (!result.ok) {
          setNotice({ tone: "error", text: result.error });
          return;
        }
        setSelectedProjectId(projectId);
        setSelectedRequestId(result.data.id);
        setConfigurationView(null);
        setNotice({ tone: "success", text: "Request created." });
        router.refresh();
      });
    },
    [router],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || (!event.metaKey && !event.ctrlKey)) return;
      const key = event.key.toLocaleLowerCase();
      if (event.shiftKey && key === "p") {
        event.preventDefault();
        setCommandPaletteOpen(true);
      } else if (key === "k") {
        event.preventDefault();
        setCommandPaletteOpen(false);
        searchRef.current?.focus();
      } else if (key === "n" && selectedProject) {
        event.preventDefault();
        createRequest(selectedProject.id, null);
      } else if (key === "b") {
        event.preventDefault();
        setSidebarOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [createRequest, selectedProject]);

  const commandActions: CommandPaletteAction[] = [
    {
      id: "new-request",
      label: "Create request",
      description: selectedProject
        ? `Add a request to ${selectedProject.name}`
        : "Create a project before adding requests",
      shortcut: "⌘/Ctrl N",
      keywords: ["new", "http"],
      disabled: !selectedProject,
      run: () => selectedProject && createRequest(selectedProject.id, null),
    },
    {
      id: "search",
      label: "Search projects and requests",
      description: "Focus the navigator search",
      shortcut: "⌘/Ctrl K",
      keywords: ["find", "filter"],
      run: () => searchRef.current?.focus(),
    },
    {
      id: "workspace-variables",
      label: "Workspace variables",
      description: "Manage environments and scoped values",
      keywords: ["environment", "configuration"],
      run: () => {
        setSelectedRequestId(null);
        setConfigurationView({ kind: "variables" });
      },
    },
    {
      id: "authentication",
      label: "Authentication profiles",
      description: "Manage reusable credentials and token requests",
      keywords: ["oauth", "api key", "basic", "bearer"],
      run: () => {
        setSelectedRequestId(null);
        setConfigurationView({
          kind: "auth",
          projectId: selectedProject?.id,
        });
      },
    },
    {
      id: "openapi",
      label: "Imported definitions",
      description: "Import or refresh an OpenAPI definition",
      keywords: ["swagger", "schema"],
      disabled: !selectedProject,
      run: () => {
        setSelectedRequestId(null);
        setConfigurationView({
          kind: "imports",
          projectId: selectedProject?.id,
        });
      },
    },
    {
      id: "collection-imports",
      label: "Collection imports",
      description: "Import HTTPie, Postman, cURL, or raw HTTP",
      keywords: ["httpie", "postman", "curl"],
      disabled: !selectedProject,
      run: () => {
        setSelectedRequestId(null);
        setConfigurationView({
          kind: "collection_imports",
          projectId: selectedProject?.id,
        });
      },
    },
    {
      id: "workflows",
      label: "Workflows",
      description: "Build and run ordered request chains",
      keywords: ["chain", "assertions"],
      disabled: !selectedProject,
      run: () => {
        setSelectedRequestId(null);
        setConfigurationView({
          kind: "workflows",
          projectId: selectedProject?.id,
        });
      },
    },
    {
      id: "settings",
      label: "Open settings",
      description: "Export, backup, restore, and configure retention",
      keywords: ["backup", "export", "restore"],
      run: () => {
        setSelectedRequestId(null);
        setConfigurationView({ kind: "settings" });
      },
    },
    {
      id: "toggle-sidebar",
      label: sidebarOpen ? "Collapse sidebar" : "Open sidebar",
      description: "Toggle the project navigator",
      shortcut: "⌘/Ctrl B",
      keywords: ["navigation", "panel"],
      run: () => setSidebarOpen((value) => !value),
    },
    {
      id: "toggle-theme",
      label: dark ? "Use light theme" : "Use dark theme",
      description: "Switch the Workbench colour theme",
      keywords: ["appearance", "dark", "light"],
      run: toggleTheme,
    },
  ];

  return (
    <div
      className="flex h-dvh min-h-[38.75rem] flex-col overflow-hidden bg-background text-foreground"
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
            <kbd className="absolute top-1.5 right-2 rounded border px-1.5 py-0.5 font-sans text-[0.625rem] text-muted">
              ⌘K
            </kbd>
          </div>
        </div>
        <span className="hidden items-center gap-2 rounded-md border border-success/25 bg-success/10 px-2.5 py-1.5 text-xs font-medium text-success sm:flex">
          <span className="size-1.5 rounded-full bg-success" /> Local
        </span>
        <Button
          aria-label="Open command palette"
          onClick={() => setCommandPaletteOpen(true)}
          size="icon"
          title="Command palette (⌘/Ctrl Shift P)"
          variant="ghost"
        >
          <Command aria-hidden="true" className="size-4" />
        </Button>
        <Button
          aria-label={dark ? "Use light theme" : "Use dark theme"}
          onClick={toggleTheme}
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
            <span className="text-[0.6875rem] font-semibold tracking-[0.12em] text-muted uppercase">
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
              <NavigationItem
                active={Boolean(
                  configurationView?.kind === "variables" &&
                  !configurationView.projectId,
                )}
                icon={Variable}
                label="Workspace variables"
                onClick={() => {
                  setSelectedRequestId(null);
                  setConfigurationView({ kind: "variables" });
                }}
              />
              <NavigationItem
                active={configurationView?.kind === "auth"}
                icon={KeyRound}
                label="Authentication profiles"
                onClick={() => {
                  setSelectedRequestId(null);
                  setConfigurationView({
                    kind: "auth",
                    projectId: selectedProject?.id,
                  });
                }}
              />
              <NavigationItem
                active={configurationView?.kind === "imports"}
                icon={Import}
                label="Imported definitions"
                onClick={() => {
                  setSelectedRequestId(null);
                  setConfigurationView({
                    kind: "imports",
                    projectId: selectedProject?.id,
                  });
                }}
              />
              <NavigationItem
                active={configurationView?.kind === "collection_imports"}
                icon={Import}
                label="Collection imports"
                onClick={() => {
                  setSelectedRequestId(null);
                  setConfigurationView({
                    kind: "collection_imports",
                    projectId: selectedProject?.id,
                  });
                }}
              />
              <NavigationItem
                active={configurationView?.kind === "workflows"}
                icon={Workflow}
                label="Workflows"
                onClick={() => {
                  setSelectedRequestId(null);
                  setConfigurationView({
                    kind: "workflows",
                    projectId: selectedProject?.id,
                  });
                }}
              />
              <NavigationItem icon={History} label="Request history" />
            </div>
            <div className="mb-2 flex items-center justify-between px-2">
              <span className="text-[0.625rem] font-semibold tracking-[0.12em] text-muted uppercase">
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
                      onClick={() => {
                        setSelectedProjectId(project.id);
                        setSelectedRequestId(null);
                        setConfigurationView(null);
                      }}
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
                      {project.requests
                        .filter(
                          (request) =>
                            request.folderId === null &&
                            (!normalisedQuery ||
                              request.name
                                .toLocaleLowerCase()
                                .includes(normalisedQuery)),
                        )
                        .map((request) => (
                          <RequestNavigationItem
                            key={request.id}
                            pending={pending}
                            request={request}
                            runMutation={runMutation}
                            selected={request.id === activeRequestId}
                            setDeleteState={setDeleteState}
                            setSelectedRequestId={(id) => {
                              setConfigurationView(null);
                              setSelectedRequestId(id);
                            }}
                          />
                        ))}
                      {project.folders.length ? (
                        <FolderTree
                          folders={project.folders}
                          onCreateRequest={createRequest}
                          pending={pending}
                          query={normalisedQuery}
                          requests={project.requests}
                          runMutation={runMutation}
                          selectedRequestId={activeRequestId}
                          setDeleteState={setDeleteState}
                          setEditor={setEditor}
                          setSelectedRequestId={(id) => {
                            setConfigurationView(null);
                            setSelectedRequestId(id);
                          }}
                        />
                      ) : (
                        <button
                          className="ml-2 flex items-center gap-2 px-2 py-2 text-[0.6875rem] text-muted hover:text-foreground"
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
                <p className="mb-1 px-2 text-[0.625rem] font-semibold tracking-wider text-muted uppercase">
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
            <NavigationItem
              active={configurationView?.kind === "settings"}
              icon={Settings2}
              label="Settings"
              onClick={() => {
                setSelectedRequestId(null);
                setConfigurationView({ kind: "settings" });
              }}
            />
          </div>
        </aside>

        {activeWorkspace ? (
          configurationView ? (
            configurationView.kind === "settings" ? (
              <BackupManager
                activeWorkspace={{
                  id: activeWorkspace.id,
                  name: activeWorkspace.name,
                }}
                onClose={() => setConfigurationView(null)}
                onRefresh={() => router.refresh()}
                project={
                  selectedProject
                    ? { id: selectedProject.id, name: selectedProject.name }
                    : undefined
                }
                workspaces={navigation.workspaces.map((workspace) => ({
                  id: workspace.id,
                  name: workspace.name,
                }))}
              />
            ) : configurationView.kind === "auth" ? (
              <AuthProfileManager
                key={`auth:${activeWorkspace.id}:${configurationView.projectId ?? "workspace"}`}
                onClose={() => setConfigurationView(null)}
                project={
                  configurationView.projectId && selectedProject
                    ? { id: selectedProject.id, name: selectedProject.name }
                    : undefined
                }
                workspace={{
                  id: activeWorkspace.id,
                  name: activeWorkspace.name,
                }}
              />
            ) : configurationView.kind === "imports" ? (
              selectedProject ? (
                <OpenApiManager
                  key={`imports:${selectedProject.id}`}
                  onClose={() => setConfigurationView(null)}
                  onNotice={(tone, text) => setNotice({ tone, text })}
                  onRefresh={() => router.refresh()}
                  project={{
                    id: selectedProject.id,
                    name: selectedProject.name,
                  }}
                />
              ) : (
                <main className="grid min-w-0 flex-1 place-items-center p-8 text-center">
                  <p className="text-sm text-muted">
                    Create a project before importing an OpenAPI definition.
                  </p>
                </main>
              )
            ) : configurationView.kind === "collection_imports" ? (
              selectedProject ? (
                <CollectionImportManager
                  key={`collection-imports:${selectedProject.id}`}
                  onClose={() => setConfigurationView(null)}
                  onNotice={(tone, text) => setNotice({ tone, text })}
                  onRefresh={() => router.refresh()}
                  project={{
                    id: selectedProject.id,
                    name: selectedProject.name,
                  }}
                />
              ) : (
                <main className="grid min-w-0 flex-1 place-items-center p-8 text-center">
                  <p className="text-sm text-muted">
                    Create a project before importing requests and collections.
                  </p>
                </main>
              )
            ) : configurationView.kind === "workflows" ? (
              selectedProject ? (
                <WorkflowManager
                  key={`workflows:${selectedProject.id}`}
                  onClose={() => setConfigurationView(null)}
                  onNotice={(tone, text) => setNotice({ tone, text })}
                  onRefresh={() => router.refresh()}
                  project={{
                    id: selectedProject.id,
                    name: selectedProject.name,
                    requests: selectedProject.requests.map((request) => ({
                      id: request.id,
                      name: request.name,
                      method: request.method,
                    })),
                  }}
                />
              ) : (
                <main className="grid min-w-0 flex-1 place-items-center p-8 text-center">
                  <p className="text-sm text-muted">
                    Create a project before building a workflow.
                  </p>
                </main>
              )
            ) : (
              <VariableManager
                key={`variables:${activeWorkspace.id}:${configurationView.projectId ?? "workspace"}`}
                onClose={() => setConfigurationView(null)}
                project={
                  configurationView.projectId && selectedProject
                    ? { id: selectedProject.id, name: selectedProject.name }
                    : undefined
                }
                workspace={{
                  id: activeWorkspace.id,
                  name: activeWorkspace.name,
                }}
              />
            )
          ) : activeRequestId && selectedProject ? (
            <RequestEditor
              folders={selectedProject.folders}
              key={activeRequestId}
              onDelete={(request) =>
                setDeleteState({ kind: "request", ...request })
              }
              onNotice={(tone, text) => setNotice({ tone, text })}
              onRefresh={() => router.refresh()}
              onSelectRequest={(id) => {
                setConfigurationView(null);
                setSelectedRequestId(id);
              }}
              requestId={activeRequestId}
            />
          ) : (
            <ProjectOverview
              onCreateRequest={createRequest}
              onManageVariables={(project) => {
                setSelectedProjectId(project.id);
                setSelectedRequestId(null);
                setConfigurationView({
                  kind: "variables",
                  projectId: project.id,
                });
              }}
              project={selectedProject}
              setEditor={setEditor}
            />
          )
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
      <CommandPalette
        actions={commandActions}
        onOpenChange={setCommandPaletteOpen}
        open={commandPaletteOpen}
        theme={dark ? "dark" : "light"}
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
