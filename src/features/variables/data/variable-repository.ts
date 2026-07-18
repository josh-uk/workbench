import "server-only";

import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";

import { getDatabase } from "@/db/client";
import {
  environments,
  projects,
  savedRequests,
  variables,
  workspaces,
} from "@/db/schema";
import { createCopyName } from "@/features/workspaces/domain";
import {
  type EnvironmentDetail,
  type PersistedVariable,
  type saveVariableScopeSchema,
  type VariableConfiguration,
  type VariableDefinition,
  VariableDomainError,
  type VariableValue,
} from "@/features/variables/domain";
import type { z } from "zod";

type Database = ReturnType<typeof getDatabase>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type QueryExecutor = Database | Transaction;
type SaveScopeValues = z.infer<typeof saveVariableScopeSchema>;

async function getWorkspace(executor: QueryExecutor, id: string) {
  const [workspace] = await executor
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.id, id))
    .limit(1);
  if (!workspace)
    throw new VariableDomainError(
      "Workspace not found.",
      "WORKSPACE_NOT_FOUND",
    );
  return workspace;
}

async function getProject(executor: QueryExecutor, id: string) {
  const [project] = await executor
    .select({ id: projects.id, workspaceId: projects.workspaceId })
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  if (!project)
    throw new VariableDomainError("Project not found.", "PROJECT_NOT_FOUND");
  return project;
}

async function getRequest(executor: QueryExecutor, id: string) {
  const [request] = await executor
    .select({ id: savedRequests.id, projectId: savedRequests.projectId })
    .from(savedRequests)
    .where(eq(savedRequests.id, id))
    .limit(1);
  if (!request)
    throw new VariableDomainError(
      "Saved request not found.",
      "REQUEST_NOT_FOUND",
    );
  return request;
}

async function getEnvironment(executor: QueryExecutor, id: string) {
  const [environment] = await executor
    .select()
    .from(environments)
    .where(eq(environments.id, id))
    .limit(1);
  if (!environment) {
    throw new VariableDomainError(
      "Environment not found.",
      "ENVIRONMENT_NOT_FOUND",
    );
  }
  return environment;
}

async function assertEnvironmentNameAvailable(
  executor: QueryExecutor,
  workspaceId: string,
  projectId: string | null,
  name: string,
  excludeId?: string,
) {
  const conditions = [
    eq(environments.workspaceId, workspaceId),
    projectId
      ? eq(environments.projectId, projectId)
      : isNull(environments.projectId),
    sql`lower(${environments.name}) = lower(${name})`,
  ];
  if (excludeId) conditions.push(ne(environments.id, excludeId));
  const [existing] = await executor
    .select({ id: environments.id })
    .from(environments)
    .where(and(...conditions))
    .limit(1);
  if (existing) {
    throw new VariableDomainError(
      "An environment with this name already exists at this scope.",
      "ENVIRONMENT_NAME_CONFLICT",
    );
  }
}

function toVariable(row: typeof variables.$inferSelect): PersistedVariable {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    environmentId: row.environmentId,
    requestId: row.requestId,
    scope: row.scope,
    name: row.name,
    value: row.value,
    secret: row.secret,
    enabled: row.enabled,
  };
}

function scopeCondition(values: SaveScopeValues) {
  switch (values.scope) {
    case "workspace":
      return and(
        eq(variables.scope, "workspace"),
        eq(variables.workspaceId, values.workspaceId as string),
        isNull(variables.environmentId),
        isNull(variables.projectId),
        isNull(variables.requestId),
      );
    case "project":
      return and(
        eq(variables.scope, "project"),
        eq(variables.projectId, values.projectId as string),
        isNull(variables.environmentId),
        isNull(variables.workspaceId),
        isNull(variables.requestId),
      );
    case "workspace_environment":
    case "project_environment":
      return and(
        eq(variables.scope, values.scope),
        eq(variables.environmentId, values.environmentId as string),
        isNull(variables.workspaceId),
        isNull(variables.projectId),
        isNull(variables.requestId),
      );
    case "request":
      return and(
        eq(variables.scope, "request"),
        eq(variables.requestId, values.requestId as string),
        isNull(variables.workspaceId),
        isNull(variables.projectId),
        isNull(variables.environmentId),
      );
  }
}

async function validateScope(executor: QueryExecutor, values: SaveScopeValues) {
  switch (values.scope) {
    case "workspace":
      if (!values.workspaceId)
        throw new VariableDomainError("Workspace scope is missing its owner.");
      await getWorkspace(executor, values.workspaceId);
      return { workspaceId: values.workspaceId };
    case "project":
      if (!values.projectId)
        throw new VariableDomainError("Project scope is missing its owner.");
      await getProject(executor, values.projectId);
      return { projectId: values.projectId };
    case "request":
      if (!values.requestId)
        throw new VariableDomainError("Request scope is missing its owner.");
      await getRequest(executor, values.requestId);
      return { requestId: values.requestId };
    case "workspace_environment":
    case "project_environment": {
      if (!values.environmentId) {
        throw new VariableDomainError(
          "Environment scope is missing its owner.",
        );
      }
      const environment = await getEnvironment(executor, values.environmentId);
      const expectedProjectScope = values.scope === "project_environment";
      if (Boolean(environment.projectId) !== expectedProjectScope) {
        throw new VariableDomainError(
          "Environment and variable scopes do not match.",
          "ENVIRONMENT_SCOPE_MISMATCH",
        );
      }
      return { environmentId: environment.id };
    }
  }
}

function assertDistinctNames(values: VariableValue[]) {
  const names = new Set<string>();
  for (const variable of values) {
    const key = variable.name.toLocaleLowerCase();
    if (names.has(key)) {
      throw new VariableDomainError(
        `Variable ${variable.name} is duplicated at this scope.`,
        "VARIABLE_NAME_CONFLICT",
      );
    }
    names.add(key);
  }
}

export async function saveVariableScope(values: SaveScopeValues) {
  const database = getDatabase();
  await database.transaction(async (transaction) => {
    const owner = await validateScope(transaction, values);
    assertDistinctNames(values.variables);
    await transaction.delete(variables).where(scopeCondition(values));
    if (values.variables.length) {
      await transaction.insert(variables).values(
        values.variables.map((variable) => ({
          ...owner,
          scope: values.scope,
          ...variable,
        })),
      );
    }
  });
}

export async function createEnvironment(values: {
  workspaceId: string;
  projectId: string | null;
  name: string;
  description: string | null;
}) {
  const database = getDatabase();
  return database.transaction(async (transaction) => {
    await getWorkspace(transaction, values.workspaceId);
    if (values.projectId) {
      const project = await getProject(transaction, values.projectId);
      if (project.workspaceId !== values.workspaceId) {
        throw new VariableDomainError(
          "Project belongs to another workspace.",
          "PROJECT_WORKSPACE_MISMATCH",
        );
      }
    }
    await assertEnvironmentNameAvailable(
      transaction,
      values.workspaceId,
      values.projectId,
      values.name,
    );
    const [environment] = await transaction
      .insert(environments)
      .values(values)
      .returning({ id: environments.id });
    if (!environment)
      throw new VariableDomainError("Environment could not be created.");
    return environment;
  });
}

export async function updateEnvironment(
  id: string,
  values: { name: string; description: string | null },
) {
  const database = getDatabase();
  const environment = await getEnvironment(database, id);
  await assertEnvironmentNameAvailable(
    database,
    environment.workspaceId,
    environment.projectId,
    values.name,
    id,
  );
  await database
    .update(environments)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(environments.id, id));
}

export async function duplicateEnvironment(id: string) {
  const database = getDatabase();
  return database.transaction(async (transaction) => {
    const source = await getEnvironment(transaction, id);
    const siblings = await transaction
      .select({ name: environments.name })
      .from(environments)
      .where(
        and(
          eq(environments.workspaceId, source.workspaceId),
          source.projectId
            ? eq(environments.projectId, source.projectId)
            : isNull(environments.projectId),
        ),
      );
    const name = createCopyName(
      source.name,
      siblings.map((item) => item.name),
    );
    const [copy] = await transaction
      .insert(environments)
      .values({
        workspaceId: source.workspaceId,
        projectId: source.projectId,
        name,
        description: source.description,
      })
      .returning({ id: environments.id });
    if (!copy)
      throw new VariableDomainError("Environment could not be duplicated.");
    const sourceVariables = await transaction
      .select()
      .from(variables)
      .where(eq(variables.environmentId, id));
    if (sourceVariables.length) {
      await transaction.insert(variables).values(
        sourceVariables.map((variable) => ({
          environmentId: copy.id,
          scope: variable.scope,
          name: variable.name,
          value: variable.value,
          secret: variable.secret,
          enabled: variable.enabled,
        })),
      );
    }
    return copy;
  });
}

export async function deleteEnvironment(id: string) {
  const database = getDatabase();
  await database.transaction(async (transaction) => {
    const environment = await getEnvironment(transaction, id);
    const selectionKey = environment.projectId
      ? "projectEnvironmentId"
      : "workspaceEnvironmentId";
    await transaction
      .update(savedRequests)
      .set({
        settings: sql`${savedRequests.settings} - ${selectionKey}`,
        updatedAt: new Date(),
      })
      .where(sql`${savedRequests.settings}->>${selectionKey} = ${id}`);
    await transaction.delete(environments).where(eq(environments.id, id));
  });
}

function groupEnvironments(
  environmentRows: Array<typeof environments.$inferSelect>,
  variableRows: PersistedVariable[],
): EnvironmentDetail[] {
  return environmentRows.map((environment) => ({
    ...environment,
    variables: variableRows.filter(
      ({ environmentId }) => environmentId === environment.id,
    ),
  }));
}

export async function getVariableConfiguration(input: {
  workspaceId: string;
  projectId: string | null;
}): Promise<VariableConfiguration> {
  const database = getDatabase();
  await getWorkspace(database, input.workspaceId);
  if (input.projectId) {
    const project = await getProject(database, input.projectId);
    if (project.workspaceId !== input.workspaceId) {
      throw new VariableDomainError(
        "Project belongs to another workspace.",
        "PROJECT_WORKSPACE_MISMATCH",
      );
    }
  }
  const [workspaceEnvironmentRows, projectEnvironmentRows, variableRows] =
    await Promise.all([
      database
        .select()
        .from(environments)
        .where(
          and(
            eq(environments.workspaceId, input.workspaceId),
            isNull(environments.projectId),
          ),
        )
        .orderBy(asc(environments.name)),
      input.projectId
        ? database
            .select()
            .from(environments)
            .where(eq(environments.projectId, input.projectId))
            .orderBy(asc(environments.name))
        : Promise.resolve([]),
      database.select().from(variables).orderBy(asc(variables.name)),
    ]);
  const relevantEnvironmentIds = new Set(
    [...workspaceEnvironmentRows, ...projectEnvironmentRows].map(
      ({ id }) => id,
    ),
  );
  const relevantVariables = variableRows
    .filter(
      (variable) =>
        variable.workspaceId === input.workspaceId ||
        variable.projectId === input.projectId ||
        (variable.environmentId &&
          relevantEnvironmentIds.has(variable.environmentId)),
    )
    .map(toVariable);

  return {
    workspaceVariables: relevantVariables.filter(
      ({ scope, workspaceId }) =>
        scope === "workspace" && workspaceId === input.workspaceId,
    ),
    workspaceEnvironments: groupEnvironments(
      workspaceEnvironmentRows,
      relevantVariables,
    ),
    projectVariables: input.projectId
      ? relevantVariables.filter(
          ({ scope, projectId }) =>
            scope === "project" && projectId === input.projectId,
        )
      : [],
    projectEnvironments: groupEnvironments(
      projectEnvironmentRows,
      relevantVariables,
    ),
  };
}

function definitions(
  rows: Array<typeof variables.$inferSelect>,
  origin: VariableDefinition["origin"],
  originLabel: string,
): VariableDefinition[] {
  return rows.map((row) => ({
    name: row.name,
    value: row.value,
    secret: row.secret,
    enabled: row.enabled,
    origin,
    originLabel,
  }));
}

export async function getVariableDefinitionsForRequest(input: {
  requestId: string;
  workspaceEnvironmentId?: string | null;
  projectEnvironmentId?: string | null;
  runtimeVariables?: VariableValue[];
  generatedVariables?: VariableValue[];
}) {
  const database = getDatabase();
  const request = await getRequest(database, input.requestId);
  const project = await getProject(database, request.projectId);
  const workspace = await getWorkspace(database, project.workspaceId);

  let workspaceEnvironment: typeof environments.$inferSelect | null = null;
  if (input.workspaceEnvironmentId) {
    workspaceEnvironment = await getEnvironment(
      database,
      input.workspaceEnvironmentId,
    );
    if (
      workspaceEnvironment.workspaceId !== workspace.id ||
      workspaceEnvironment.projectId
    ) {
      throw new VariableDomainError(
        "The selected workspace environment is invalid.",
        "ENVIRONMENT_SELECTION_INVALID",
      );
    }
  }

  let projectEnvironment: typeof environments.$inferSelect | null = null;
  if (input.projectEnvironmentId) {
    projectEnvironment = await getEnvironment(
      database,
      input.projectEnvironmentId,
    );
    if (projectEnvironment.projectId !== project.id) {
      throw new VariableDomainError(
        "The selected project environment is invalid.",
        "ENVIRONMENT_SELECTION_INVALID",
      );
    }
  }

  const [
    workspaceRows,
    workspaceEnvironmentRows,
    projectRows,
    projectEnvironmentRows,
    requestRows,
  ] = await Promise.all([
    database
      .select()
      .from(variables)
      .where(
        and(
          eq(variables.scope, "workspace"),
          eq(variables.workspaceId, workspace.id),
        ),
      )
      .orderBy(asc(variables.name)),
    workspaceEnvironment
      ? database
          .select()
          .from(variables)
          .where(eq(variables.environmentId, workspaceEnvironment.id))
          .orderBy(asc(variables.name))
      : Promise.resolve([]),
    database
      .select()
      .from(variables)
      .where(
        and(
          eq(variables.scope, "project"),
          eq(variables.projectId, project.id),
        ),
      )
      .orderBy(asc(variables.name)),
    projectEnvironment
      ? database
          .select()
          .from(variables)
          .where(eq(variables.environmentId, projectEnvironment.id))
          .orderBy(asc(variables.name))
      : Promise.resolve([]),
    database
      .select()
      .from(variables)
      .where(
        and(
          eq(variables.scope, "request"),
          eq(variables.requestId, request.id),
        ),
      )
      .orderBy(asc(variables.name)),
  ]);

  return [
    ...definitions(workspaceRows, "workspace", "Workspace"),
    ...definitions(
      workspaceEnvironmentRows,
      "workspace_environment",
      `Workspace environment: ${workspaceEnvironment?.name ?? "None"}`,
    ),
    ...definitions(projectRows, "project", "Project"),
    ...definitions(
      projectEnvironmentRows,
      "project_environment",
      `Project environment: ${projectEnvironment?.name ?? "None"}`,
    ),
    ...(input.generatedVariables ?? []).map((variable) => ({
      ...variable,
      origin: "generated" as const,
      originLabel: "Generated runtime output",
    })),
    ...definitions(requestRows, "request", "Request"),
    ...(input.runtimeVariables ?? []).map((variable) => ({
      ...variable,
      origin: "runtime" as const,
      originLabel: "Temporary runtime override",
    })),
  ];
}
