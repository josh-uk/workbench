import "server-only";

import {
  and,
  asc,
  count,
  eq,
  isNotNull,
  isNull,
  max,
  ne,
  sql,
} from "drizzle-orm";

import { getDatabase } from "@/db/client";
import {
  applicationSettings,
  environments,
  folders,
  projects,
  requestBodies,
  requestExecutions,
  requestHeaders,
  requestQueryParameters,
  savedRequests,
  variables,
  workspaces,
} from "@/db/schema";
import { parseRequestSettings } from "@/features/requests/domain";
import {
  buildFolderTree,
  createCopyName,
  type WorkbenchNavigation,
  WorkspaceDomainError,
} from "@/features/workspaces/domain";

const activeWorkspaceSettingKey = "navigation.activeWorkspaceId";

type Database = ReturnType<typeof getDatabase>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type QueryExecutor = Database | Transaction;

interface WorkspaceValues {
  name: string;
  description: string | null;
}

interface ProjectValues extends WorkspaceValues {
  workspaceId: string;
}

interface FolderValues {
  projectId: string;
  parentId: string | null;
  name: string;
}

async function getNextPosition(
  executor: QueryExecutor,
  table: typeof workspaces | typeof projects | typeof folders,
  where?: ReturnType<typeof and> | ReturnType<typeof eq>,
) {
  const [result] = await executor
    .select({ value: max(table.position) })
    .from(table)
    .where(where);

  return Number(result?.value ?? -1) + 1;
}

async function getWorkspace(executor: QueryExecutor, id: string) {
  const [workspace] = await executor
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, id))
    .limit(1);

  if (!workspace) {
    throw new WorkspaceDomainError("Workspace not found.");
  }

  return workspace;
}

async function getProject(executor: QueryExecutor, id: string) {
  const [project] = await executor
    .select()
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);

  if (!project) {
    throw new WorkspaceDomainError("Project not found.");
  }

  return project;
}

async function getFolder(executor: QueryExecutor, id: string) {
  const [folder] = await executor
    .select()
    .from(folders)
    .where(eq(folders.id, id))
    .limit(1);

  if (!folder) {
    throw new WorkspaceDomainError("Folder not found.");
  }

  return folder;
}

async function assertWorkspaceNameAvailable(
  executor: QueryExecutor,
  name: string,
  excludeId?: string,
) {
  const conditions = [sql`lower(${workspaces.name}) = lower(${name})`];
  if (excludeId) conditions.push(ne(workspaces.id, excludeId));

  const [existing] = await executor
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(...conditions))
    .limit(1);

  if (existing) {
    throw new WorkspaceDomainError(
      "A workspace with this name already exists.",
    );
  }
}

async function assertProjectNameAvailable(
  executor: QueryExecutor,
  workspaceId: string,
  name: string,
  excludeId?: string,
) {
  const conditions = [
    eq(projects.workspaceId, workspaceId),
    sql`lower(${projects.name}) = lower(${name})`,
  ];
  if (excludeId) conditions.push(ne(projects.id, excludeId));

  const [existing] = await executor
    .select({ id: projects.id })
    .from(projects)
    .where(and(...conditions))
    .limit(1);

  if (existing) {
    throw new WorkspaceDomainError(
      "A project with this name already exists in the workspace.",
    );
  }
}

function folderParentCondition(projectId: string, parentId: string | null) {
  return and(
    eq(folders.projectId, projectId),
    parentId ? eq(folders.parentId, parentId) : isNull(folders.parentId),
  );
}

async function assertFolderNameAvailable(
  executor: QueryExecutor,
  projectId: string,
  parentId: string | null,
  name: string,
  excludeId?: string,
) {
  const conditions = [
    folderParentCondition(projectId, parentId),
    sql`lower(${folders.name}) = lower(${name})`,
  ];
  if (excludeId) conditions.push(ne(folders.id, excludeId));

  const [existing] = await executor
    .select({ id: folders.id })
    .from(folders)
    .where(and(...conditions))
    .limit(1);

  if (existing) {
    throw new WorkspaceDomainError(
      "A folder with this name already exists here.",
    );
  }
}

async function setActiveWorkspace(
  executor: QueryExecutor,
  workspaceId: string,
) {
  await executor
    .insert(applicationSettings)
    .values({ key: activeWorkspaceSettingKey, value: workspaceId })
    .onConflictDoUpdate({
      target: applicationSettings.key,
      set: { value: workspaceId, updatedAt: new Date() },
    });
}

async function copyFolderHierarchy(
  executor: QueryExecutor,
  sourceProjectId: string,
  targetProjectId: string,
) {
  const sourceFolders = await executor
    .select()
    .from(folders)
    .where(eq(folders.projectId, sourceProjectId))
    .orderBy(asc(folders.position), asc(folders.name));

  const idMap = new Map<string, string>();
  let pending = [...sourceFolders];

  while (pending.length > 0) {
    const ready = pending.filter(
      (folder) => !folder.parentId || idMap.has(folder.parentId),
    );

    if (ready.length === 0) {
      throw new WorkspaceDomainError(
        "The source folder hierarchy contains a cycle.",
      );
    }

    for (const folder of ready) {
      const [copy] = await executor
        .insert(folders)
        .values({
          projectId: targetProjectId,
          parentId: folder.parentId
            ? (idMap.get(folder.parentId) ?? null)
            : null,
          name: folder.name,
          position: folder.position,
        })
        .returning({ id: folders.id });

      if (copy) idMap.set(folder.id, copy.id);
    }

    const copiedIds = new Set(ready.map(({ id }) => id));
    pending = pending.filter(({ id }) => !copiedIds.has(id));
  }

  return idMap;
}

async function copyProjectRequests(
  executor: QueryExecutor,
  sourceProjectId: string,
  targetProjectId: string,
  folderIds: ReadonlyMap<string, string>,
  projectEnvironmentIds: ReadonlyMap<string, string> = new Map(),
  workspaceEnvironmentIds?: ReadonlyMap<string, string>,
) {
  const sourceRequests = await executor
    .select()
    .from(savedRequests)
    .where(eq(savedRequests.projectId, sourceProjectId))
    .orderBy(asc(savedRequests.position), asc(savedRequests.name));

  for (const source of sourceRequests) {
    const settings = parseRequestSettings(source.settings);
    const workspaceEnvironmentId = settings.workspaceEnvironmentId
      ? workspaceEnvironmentIds
        ? (workspaceEnvironmentIds.get(settings.workspaceEnvironmentId) ?? null)
        : settings.workspaceEnvironmentId
      : null;
    const projectEnvironmentId = settings.projectEnvironmentId
      ? (projectEnvironmentIds.get(settings.projectEnvironmentId) ?? null)
      : null;
    const [copy] = await executor
      .insert(savedRequests)
      .values({
        projectId: targetProjectId,
        folderId: source.folderId
          ? (folderIds.get(source.folderId) ?? null)
          : null,
        name: source.name,
        description: source.description,
        method: source.method,
        url: source.url,
        position: source.position,
        tags: source.tags,
        settings: {
          ...settings,
          workspaceEnvironmentId,
          projectEnvironmentId,
        },
      })
      .returning({ id: savedRequests.id });
    if (!copy) continue;

    const [headers, queryParameters, bodies, requestVariables] =
      await Promise.all([
        executor
          .select()
          .from(requestHeaders)
          .where(eq(requestHeaders.requestId, source.id)),
        executor
          .select()
          .from(requestQueryParameters)
          .where(eq(requestQueryParameters.requestId, source.id)),
        executor
          .select()
          .from(requestBodies)
          .where(eq(requestBodies.requestId, source.id)),
        executor
          .select()
          .from(variables)
          .where(
            and(
              eq(variables.scope, "request"),
              eq(variables.requestId, source.id),
            ),
          ),
      ]);
    if (headers.length) {
      await executor.insert(requestHeaders).values(
        headers.map((header) => ({
          requestId: copy.id,
          name: header.name,
          value: header.value,
          enabled: header.enabled,
          secret: header.secret,
          position: header.position,
        })),
      );
    }
    if (queryParameters.length) {
      await executor.insert(requestQueryParameters).values(
        queryParameters.map((parameter) => ({
          requestId: copy.id,
          name: parameter.name,
          value: parameter.value,
          enabled: parameter.enabled,
          position: parameter.position,
        })),
      );
    }
    if (bodies[0]) {
      const body = bodies[0];
      await executor.insert(requestBodies).values({
        requestId: copy.id,
        type: body.type,
        content: body.content,
        contentType: body.contentType,
        metadata: body.metadata,
      });
    }
    if (requestVariables.length) {
      await executor.insert(variables).values(
        requestVariables.map((variable) => ({
          requestId: copy.id,
          scope: "request" as const,
          name: variable.name,
          value: variable.value,
          secret: variable.secret,
          enabled: variable.enabled,
        })),
      );
    }
  }
}

async function copyEnvironmentVariables(
  executor: QueryExecutor,
  sourceEnvironmentId: string,
  targetEnvironmentId: string,
  scope: "workspace_environment" | "project_environment",
) {
  const rows = await executor
    .select()
    .from(variables)
    .where(eq(variables.environmentId, sourceEnvironmentId));
  if (rows.length) {
    await executor.insert(variables).values(
      rows.map((variable) => ({
        environmentId: targetEnvironmentId,
        scope,
        name: variable.name,
        value: variable.value,
        secret: variable.secret,
        enabled: variable.enabled,
      })),
    );
  }
}

async function copyWorkspaceConfiguration(
  executor: QueryExecutor,
  sourceWorkspaceId: string,
  targetWorkspaceId: string,
) {
  const [workspaceVariables, workspaceEnvironments] = await Promise.all([
    executor
      .select()
      .from(variables)
      .where(
        and(
          eq(variables.scope, "workspace"),
          eq(variables.workspaceId, sourceWorkspaceId),
        ),
      ),
    executor
      .select()
      .from(environments)
      .where(
        and(
          eq(environments.workspaceId, sourceWorkspaceId),
          isNull(environments.projectId),
        ),
      ),
  ]);
  if (workspaceVariables.length) {
    await executor.insert(variables).values(
      workspaceVariables.map((variable) => ({
        workspaceId: targetWorkspaceId,
        scope: "workspace" as const,
        name: variable.name,
        value: variable.value,
        secret: variable.secret,
        enabled: variable.enabled,
      })),
    );
  }
  const environmentIds = new Map<string, string>();
  for (const source of workspaceEnvironments) {
    const [copy] = await executor
      .insert(environments)
      .values({
        workspaceId: targetWorkspaceId,
        projectId: null,
        name: source.name,
        description: source.description,
      })
      .returning({ id: environments.id });
    if (!copy) continue;
    environmentIds.set(source.id, copy.id);
    await copyEnvironmentVariables(
      executor,
      source.id,
      copy.id,
      "workspace_environment",
    );
  }
  return environmentIds;
}

async function copyProjectConfiguration(
  executor: QueryExecutor,
  sourceProjectId: string,
  targetProjectId: string,
  targetWorkspaceId: string,
) {
  const [projectVariables, projectEnvironments] = await Promise.all([
    executor
      .select()
      .from(variables)
      .where(
        and(
          eq(variables.scope, "project"),
          eq(variables.projectId, sourceProjectId),
        ),
      ),
    executor
      .select()
      .from(environments)
      .where(eq(environments.projectId, sourceProjectId)),
  ]);
  if (projectVariables.length) {
    await executor.insert(variables).values(
      projectVariables.map((variable) => ({
        projectId: targetProjectId,
        scope: "project" as const,
        name: variable.name,
        value: variable.value,
        secret: variable.secret,
        enabled: variable.enabled,
      })),
    );
  }
  const environmentIds = new Map<string, string>();
  for (const source of projectEnvironments) {
    const [copy] = await executor
      .insert(environments)
      .values({
        workspaceId: targetWorkspaceId,
        projectId: targetProjectId,
        name: source.name,
        description: source.description,
      })
      .returning({ id: environments.id });
    if (!copy) continue;
    environmentIds.set(source.id, copy.id);
    await copyEnvironmentVariables(
      executor,
      source.id,
      copy.id,
      "project_environment",
    );
  }
  return environmentIds;
}

export async function getWorkbenchNavigation(): Promise<WorkbenchNavigation> {
  const database = getDatabase();
  const [
    workspaceRows,
    projectRows,
    folderRows,
    requestCountRows,
    folderRequestCountRows,
    requestRows,
    executionCountRows,
    settingRows,
  ] = await Promise.all([
    database
      .select()
      .from(workspaces)
      .orderBy(asc(workspaces.position), asc(workspaces.name)),
    database
      .select()
      .from(projects)
      .orderBy(asc(projects.position), asc(projects.name)),
    database
      .select()
      .from(folders)
      .orderBy(asc(folders.position), asc(folders.name)),
    database
      .select({ projectId: savedRequests.projectId, value: count() })
      .from(savedRequests)
      .groupBy(savedRequests.projectId),
    database
      .select({ folderId: savedRequests.folderId, value: count() })
      .from(savedRequests)
      .where(isNotNull(savedRequests.folderId))
      .groupBy(savedRequests.folderId),
    database
      .select({
        id: savedRequests.id,
        projectId: savedRequests.projectId,
        folderId: savedRequests.folderId,
        name: savedRequests.name,
        method: savedRequests.method,
        position: savedRequests.position,
      })
      .from(savedRequests)
      .orderBy(asc(savedRequests.position), asc(savedRequests.name)),
    database
      .select({ projectId: requestExecutions.projectId, value: count() })
      .from(requestExecutions)
      .groupBy(requestExecutions.projectId),
    database
      .select({ value: applicationSettings.value })
      .from(applicationSettings)
      .where(eq(applicationSettings.key, activeWorkspaceSettingKey))
      .limit(1),
  ]);

  const projectRequestCounts = new Map(
    requestCountRows.map((row) => [row.projectId, Number(row.value)]),
  );
  const folderRequestCounts = new Map(
    folderRequestCountRows.flatMap((row) =>
      row.folderId ? [[row.folderId, Number(row.value)] as const] : [],
    ),
  );
  const executionCounts = new Map(
    executionCountRows.map((row) => [row.projectId, Number(row.value)]),
  );
  const requestsByProject = new Map<string, typeof requestRows>();
  for (const request of requestRows) {
    const rows = requestsByProject.get(request.projectId) ?? [];
    rows.push(request);
    requestsByProject.set(request.projectId, rows);
  }
  const foldersByProject = new Map<string, typeof folderRows>();

  for (const folder of folderRows) {
    const rows = foldersByProject.get(folder.projectId) ?? [];
    rows.push(folder);
    foldersByProject.set(folder.projectId, rows);
  }

  const projectsByWorkspace = new Map<string, typeof projectRows>();
  for (const project of projectRows) {
    const rows = projectsByWorkspace.get(project.workspaceId) ?? [];
    rows.push(project);
    projectsByWorkspace.set(project.workspaceId, rows);
  }

  const navigationWorkspaces = workspaceRows.map((workspace) => ({
    id: workspace.id,
    name: workspace.name,
    description: workspace.description,
    position: workspace.position,
    projects: (projectsByWorkspace.get(workspace.id) ?? []).map((project) => ({
      id: project.id,
      workspaceId: project.workspaceId,
      name: project.name,
      description: project.description,
      position: project.position,
      archived: project.archived,
      requestCount: projectRequestCounts.get(project.id) ?? 0,
      executionCount: executionCounts.get(project.id) ?? 0,
      requests: requestsByProject.get(project.id) ?? [],
      folders: buildFolderTree(
        (foldersByProject.get(project.id) ?? []).map((folder) => ({
          ...folder,
          requestCount: folderRequestCounts.get(folder.id) ?? 0,
        })),
      ),
    })),
  }));

  const configuredId =
    typeof settingRows[0]?.value === "string" ? settingRows[0].value : null;
  const activeWorkspaceId = navigationWorkspaces.some(
    ({ id }) => id === configuredId,
  )
    ? configuredId
    : (navigationWorkspaces[0]?.id ?? null);

  return { activeWorkspaceId, workspaces: navigationWorkspaces };
}

export async function createWorkspace(values: WorkspaceValues) {
  const database = getDatabase();

  return database.transaction(async (transaction) => {
    await assertWorkspaceNameAvailable(transaction, values.name);
    const position = await getNextPosition(transaction, workspaces);
    const [workspace] = await transaction
      .insert(workspaces)
      .values({ ...values, position })
      .returning({ id: workspaces.id });

    if (!workspace)
      throw new WorkspaceDomainError("Workspace could not be created.");
    await setActiveWorkspace(transaction, workspace.id);
    return workspace;
  });
}

export async function updateWorkspace(id: string, values: WorkspaceValues) {
  const database = getDatabase();
  await getWorkspace(database, id);
  await assertWorkspaceNameAvailable(database, values.name, id);
  await database
    .update(workspaces)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(workspaces.id, id));
}

export async function selectWorkspace(id: string) {
  const database = getDatabase();
  await getWorkspace(database, id);
  await setActiveWorkspace(database, id);
}

export async function deleteWorkspace(id: string) {
  const database = getDatabase();

  await database.transaction(async (transaction) => {
    await getWorkspace(transaction, id);
    await transaction.delete(workspaces).where(eq(workspaces.id, id));
    const [nextWorkspace] = await transaction
      .select({ id: workspaces.id })
      .from(workspaces)
      .orderBy(asc(workspaces.position), asc(workspaces.name))
      .limit(1);

    if (nextWorkspace) {
      await setActiveWorkspace(transaction, nextWorkspace.id);
    } else {
      await transaction
        .delete(applicationSettings)
        .where(eq(applicationSettings.key, activeWorkspaceSettingKey));
    }
  });
}

export async function duplicateWorkspace(id: string) {
  const database = getDatabase();

  return database.transaction(async (transaction) => {
    const source = await getWorkspace(transaction, id);
    const existing = await transaction
      .select({ name: workspaces.name })
      .from(workspaces);
    const name = createCopyName(
      source.name,
      existing.map(({ name }) => name),
    );
    const position = await getNextPosition(transaction, workspaces);
    const [workspace] = await transaction
      .insert(workspaces)
      .values({ name, description: source.description, position })
      .returning({ id: workspaces.id });

    if (!workspace)
      throw new WorkspaceDomainError("Workspace could not be duplicated.");

    const workspaceEnvironmentIds = await copyWorkspaceConfiguration(
      transaction,
      source.id,
      workspace.id,
    );

    const sourceProjects = await transaction
      .select()
      .from(projects)
      .where(eq(projects.workspaceId, id))
      .orderBy(asc(projects.position), asc(projects.name));

    for (const sourceProject of sourceProjects) {
      const [project] = await transaction
        .insert(projects)
        .values({
          workspaceId: workspace.id,
          name: sourceProject.name,
          description: sourceProject.description,
          position: sourceProject.position,
          archived: sourceProject.archived,
        })
        .returning({ id: projects.id });

      if (project) {
        const projectEnvironmentIds = await copyProjectConfiguration(
          transaction,
          sourceProject.id,
          project.id,
          workspace.id,
        );
        const folderIds = await copyFolderHierarchy(
          transaction,
          sourceProject.id,
          project.id,
        );
        await copyProjectRequests(
          transaction,
          sourceProject.id,
          project.id,
          folderIds,
          projectEnvironmentIds,
          workspaceEnvironmentIds,
        );
      }
    }

    await setActiveWorkspace(transaction, workspace.id);
    return workspace;
  });
}

export async function createProject(values: ProjectValues) {
  const database = getDatabase();

  return database.transaction(async (transaction) => {
    await getWorkspace(transaction, values.workspaceId);
    await assertProjectNameAvailable(
      transaction,
      values.workspaceId,
      values.name,
    );
    const position = await getNextPosition(
      transaction,
      projects,
      eq(projects.workspaceId, values.workspaceId),
    );
    const [project] = await transaction
      .insert(projects)
      .values({ ...values, position })
      .returning({ id: projects.id });

    if (!project)
      throw new WorkspaceDomainError("Project could not be created.");
    return project;
  });
}

export async function updateProject(id: string, values: WorkspaceValues) {
  const database = getDatabase();
  const project = await getProject(database, id);
  await assertProjectNameAvailable(
    database,
    project.workspaceId,
    values.name,
    id,
  );
  await database
    .update(projects)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(projects.id, id));
}

export async function setProjectArchived(id: string, archived: boolean) {
  const database = getDatabase();
  await getProject(database, id);
  await database
    .update(projects)
    .set({ archived, updatedAt: new Date() })
    .where(eq(projects.id, id));
}

export async function deleteProject(id: string) {
  const database = getDatabase();
  await getProject(database, id);
  await database.delete(projects).where(eq(projects.id, id));
}

export async function duplicateProject(id: string) {
  const database = getDatabase();

  return database.transaction(async (transaction) => {
    const source = await getProject(transaction, id);
    const existing = await transaction
      .select({ name: projects.name })
      .from(projects)
      .where(eq(projects.workspaceId, source.workspaceId));
    const name = createCopyName(
      source.name,
      existing.map(({ name }) => name),
    );
    const position = await getNextPosition(
      transaction,
      projects,
      eq(projects.workspaceId, source.workspaceId),
    );
    const [project] = await transaction
      .insert(projects)
      .values({
        workspaceId: source.workspaceId,
        name,
        description: source.description,
        position,
      })
      .returning({ id: projects.id });

    if (!project)
      throw new WorkspaceDomainError("Project could not be duplicated.");
    const folderIds = await copyFolderHierarchy(
      transaction,
      source.id,
      project.id,
    );
    const projectEnvironmentIds = await copyProjectConfiguration(
      transaction,
      source.id,
      project.id,
      source.workspaceId,
    );
    await copyProjectRequests(
      transaction,
      source.id,
      project.id,
      folderIds,
      projectEnvironmentIds,
    );
    return project;
  });
}

export async function moveProject(id: string, direction: "up" | "down") {
  const database = getDatabase();

  await database.transaction(async (transaction) => {
    const project = await getProject(transaction, id);
    const siblings = await transaction
      .select({ id: projects.id, position: projects.position })
      .from(projects)
      .where(eq(projects.workspaceId, project.workspaceId))
      .orderBy(asc(projects.position), asc(projects.name));
    const index = siblings.findIndex((sibling) => sibling.id === id);
    const target = siblings[index + (direction === "up" ? -1 : 1)];

    if (!target) return;
    await transaction
      .update(projects)
      .set({ position: target.position, updatedAt: new Date() })
      .where(eq(projects.id, id));
    await transaction
      .update(projects)
      .set({ position: project.position, updatedAt: new Date() })
      .where(eq(projects.id, target.id));
  });
}

export async function createFolder(values: FolderValues) {
  const database = getDatabase();

  return database.transaction(async (transaction) => {
    await getProject(transaction, values.projectId);
    if (values.parentId) {
      const parent = await getFolder(transaction, values.parentId);
      if (parent.projectId !== values.projectId) {
        throw new WorkspaceDomainError(
          "Parent folder belongs to another project.",
        );
      }
    }

    await assertFolderNameAvailable(
      transaction,
      values.projectId,
      values.parentId,
      values.name,
    );
    const position = await getNextPosition(
      transaction,
      folders,
      folderParentCondition(values.projectId, values.parentId),
    );
    const [folder] = await transaction
      .insert(folders)
      .values({ ...values, position })
      .returning({ id: folders.id });

    if (!folder) throw new WorkspaceDomainError("Folder could not be created.");
    return folder;
  });
}

export async function updateFolder(id: string, name: string) {
  const database = getDatabase();
  const folder = await getFolder(database, id);
  await assertFolderNameAvailable(
    database,
    folder.projectId,
    folder.parentId,
    name,
    id,
  );
  await database
    .update(folders)
    .set({ name, updatedAt: new Date() })
    .where(eq(folders.id, id));
}

export async function deleteFolder(id: string) {
  const database = getDatabase();
  await getFolder(database, id);
  await database.delete(folders).where(eq(folders.id, id));
}

export async function moveFolder(id: string, direction: "up" | "down") {
  const database = getDatabase();

  await database.transaction(async (transaction) => {
    const folder = await getFolder(transaction, id);
    const siblings = await transaction
      .select({ id: folders.id, position: folders.position })
      .from(folders)
      .where(folderParentCondition(folder.projectId, folder.parentId))
      .orderBy(asc(folders.position), asc(folders.name));
    const index = siblings.findIndex((sibling) => sibling.id === id);
    const target = siblings[index + (direction === "up" ? -1 : 1)];

    if (!target) return;
    await transaction
      .update(folders)
      .set({ position: target.position, updatedAt: new Date() })
      .where(eq(folders.id, id));
    await transaction
      .update(folders)
      .set({ position: folder.position, updatedAt: new Date() })
      .where(eq(folders.id, target.id));
  });
}

export async function relocateFolder(id: string, parentId: string | null) {
  const database = getDatabase();

  await database.transaction(async (transaction) => {
    const folder = await getFolder(transaction, id);
    if (folder.parentId === parentId) return;
    if (parentId === id) {
      throw new WorkspaceDomainError("A folder cannot contain itself.");
    }

    const projectFolders = await transaction
      .select({ id: folders.id, parentId: folders.parentId })
      .from(folders)
      .where(eq(folders.projectId, folder.projectId));
    const descendants = new Set<string>();
    let frontier = [id];

    while (frontier.length > 0) {
      const children = projectFolders
        .filter(
          (candidate) =>
            candidate.parentId && frontier.includes(candidate.parentId),
        )
        .map((candidate) => candidate.id)
        .filter((candidateId) => !descendants.has(candidateId));
      children.forEach((childId) => descendants.add(childId));
      frontier = children;
    }

    if (parentId && descendants.has(parentId)) {
      throw new WorkspaceDomainError(
        "A folder cannot be moved into one of its descendants.",
      );
    }

    if (parentId) {
      const parent = await getFolder(transaction, parentId);
      if (parent.projectId !== folder.projectId) {
        throw new WorkspaceDomainError(
          "Destination folder belongs to another project.",
        );
      }
    }

    await assertFolderNameAvailable(
      transaction,
      folder.projectId,
      parentId,
      folder.name,
      folder.id,
    );
    const position = await getNextPosition(
      transaction,
      folders,
      folderParentCondition(folder.projectId, parentId),
    );
    await transaction
      .update(folders)
      .set({ parentId, position, updatedAt: new Date() })
      .where(eq(folders.id, id));
  });
}
