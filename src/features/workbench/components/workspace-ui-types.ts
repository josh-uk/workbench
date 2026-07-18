import type { ActionResult } from "@/features/workspaces/domain";

export type EditorState =
  | { kind: "create-workspace"; name: string; description: string }
  | {
      kind: "edit-workspace";
      id: string;
      name: string;
      description: string;
    }
  | {
      kind: "create-project";
      workspaceId: string;
      name: string;
      description: string;
    }
  | {
      kind: "edit-project";
      id: string;
      name: string;
      description: string;
    }
  | {
      kind: "create-folder";
      projectId: string;
      parentId: string | null;
      name: string;
    }
  | { kind: "edit-folder"; id: string; name: string }
  | {
      kind: "relocate-folder";
      id: string;
      name: string;
      parentId: string | null;
    };

export type DeleteState =
  | { kind: "workspace"; id: string; name: string }
  | { kind: "project"; id: string; name: string }
  | { kind: "folder"; id: string; name: string }
  | { kind: "request"; id: string; name: string };

export type Mutation = () => Promise<ActionResult<unknown>>;
