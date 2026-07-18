import { z } from "zod";

export const entityIdSchema = z.uuid();

export const entityNameSchema = z
  .string()
  .trim()
  .min(1, "Name is required.")
  .max(120, "Name must be 120 characters or fewer.");

export const entityDescriptionSchema = z
  .string()
  .trim()
  .max(2_000, "Description must be 2,000 characters or fewer.")
  .transform((value) => value || null);

export const createWorkspaceSchema = z.object({
  name: entityNameSchema,
  description: entityDescriptionSchema.default(""),
});

export const updateWorkspaceSchema = createWorkspaceSchema.extend({
  id: entityIdSchema,
});

export const workspaceIdSchema = z.object({ workspaceId: entityIdSchema });

export const createProjectSchema = z.object({
  workspaceId: entityIdSchema,
  name: entityNameSchema,
  description: entityDescriptionSchema.default(""),
});

export const updateProjectSchema = z.object({
  id: entityIdSchema,
  name: entityNameSchema,
  description: entityDescriptionSchema.default(""),
});

export const projectIdSchema = z.object({ projectId: entityIdSchema });

export const moveProjectSchema = projectIdSchema.extend({
  direction: z.enum(["up", "down"]),
});

export const createFolderSchema = z.object({
  projectId: entityIdSchema,
  parentId: entityIdSchema.nullable().default(null),
  name: entityNameSchema,
});

export const updateFolderSchema = z.object({
  id: entityIdSchema,
  name: entityNameSchema,
});

export const folderIdSchema = z.object({ folderId: entityIdSchema });

export const moveFolderSchema = folderIdSchema.extend({
  direction: z.enum(["up", "down"]),
});

export const relocateFolderSchema = folderIdSchema.extend({
  parentId: entityIdSchema.nullable(),
});

export interface FolderRow {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  position: number;
  requestCount?: number;
}

export interface FolderNode extends FolderRow {
  children: FolderNode[];
}

export interface ProjectNavigation {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  position: number;
  archived: boolean;
  requestCount: number;
  folders: FolderNode[];
}

export interface WorkspaceNavigation {
  id: string;
  name: string;
  description: string | null;
  position: number;
  projects: ProjectNavigation[];
}

export interface WorkbenchNavigation {
  activeWorkspaceId: string | null;
  workspaces: WorkspaceNavigation[];
}

export type ActionResult<T = undefined> =
  { ok: true; data: T } | { ok: false; error: string };

function comparePositionThenName(
  left: Pick<FolderRow, "position" | "name">,
  right: Pick<FolderRow, "position" | "name">,
) {
  return left.position - right.position || left.name.localeCompare(right.name);
}

export function buildFolderTree(rows: readonly FolderRow[]): FolderNode[] {
  const nodes = new Map<string, FolderNode>();

  for (const row of rows) {
    nodes.set(row.id, {
      ...row,
      requestCount: row.requestCount ?? 0,
      children: [],
    });
  }

  const roots: FolderNode[] = [];

  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;

    if (
      parent &&
      parent.projectId === node.projectId &&
      parent.id !== node.id
    ) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortNodes = (items: FolderNode[]) => {
    items.sort(comparePositionThenName);
    items.forEach((item) => sortNodes(item.children));
  };

  sortNodes(roots);
  return roots;
}

export function collectFolderIds(nodes: readonly FolderNode[]): string[] {
  return nodes.flatMap((node) => [node.id, ...collectFolderIds(node.children)]);
}

export function createCopyName(
  originalName: string,
  existingNames: readonly string[],
) {
  const names = new Set(existingNames.map((name) => name.toLocaleLowerCase()));
  const base = `${originalName} copy`;

  if (!names.has(base.toLocaleLowerCase())) {
    return base;
  }

  let suffix = 2;
  while (names.has(`${base} ${suffix}`.toLocaleLowerCase())) {
    suffix += 1;
  }

  return `${base} ${suffix}`;
}

export class WorkspaceDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceDomainError";
  }
}
