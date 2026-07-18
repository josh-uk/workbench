import "server-only";

import { and, asc, eq, ne, sql } from "drizzle-orm";

import { getDatabase } from "@/db/client";
import {
  authProfileOverrides,
  authProfiles,
  authTokenCache,
  projects,
  savedRequests,
  workspaces,
} from "@/db/schema";

import {
  AUTH_SECRET_PLACEHOLDER,
  type AuthConfiguration,
  type AuthProfileConfiguration,
  type AuthProfileDetail,
  AuthDomainError,
  authSecretFields,
  type EffectiveAuthProfile,
  parseAuthConfiguration,
} from "../domain";

type Database = ReturnType<typeof getDatabase>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type QueryExecutor = Database | Transaction;

async function getWorkspace(executor: QueryExecutor, id: string) {
  const [workspace] = await executor
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.id, id))
    .limit(1);
  if (!workspace)
    throw new AuthDomainError("Workspace not found.", "WORKSPACE_NOT_FOUND");
  return workspace;
}

async function getProject(executor: QueryExecutor, id: string) {
  const [project] = await executor
    .select({ id: projects.id, workspaceId: projects.workspaceId })
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  if (!project)
    throw new AuthDomainError("Project not found.", "PROJECT_NOT_FOUND");
  return project;
}

async function getProfile(executor: QueryExecutor, id: string) {
  const [profile] = await executor
    .select()
    .from(authProfiles)
    .where(eq(authProfiles.id, id))
    .limit(1);
  if (!profile) {
    throw new AuthDomainError(
      "Authentication profile not found.",
      "AUTH_PROFILE_NOT_FOUND",
    );
  }
  return profile;
}

function mergeConfiguration(
  base: AuthProfileConfiguration,
  changes: Partial<AuthProfileConfiguration>,
) {
  const result = { ...base };
  for (const [key, value] of Object.entries(changes) as Array<
    [
      keyof AuthProfileConfiguration,
      AuthProfileConfiguration[keyof AuthProfileConfiguration],
    ]
  >) {
    if (authSecretFields.has(key) && value === AUTH_SECRET_PLACEHOLDER)
      continue;
    Object.assign(result, { [key]: value });
  }
  return parseAuthConfiguration(result);
}

function redactedConfiguration(configuration: AuthProfileConfiguration) {
  const result = { ...configuration };
  for (const key of authSecretFields) {
    if (result[key]) Object.assign(result, { [key]: AUTH_SECRET_PLACEHOLDER });
  }
  return result;
}

async function validateOwner(
  executor: QueryExecutor,
  workspaceId: string | null,
  projectId: string | null,
) {
  if (workspaceId) {
    await getWorkspace(executor, workspaceId);
    return { workspaceId, projectId: null, ownerWorkspaceId: workspaceId };
  }
  if (!projectId)
    throw new AuthDomainError("Authentication profile owner is missing.");
  const project = await getProject(executor, projectId);
  return {
    workspaceId: null,
    projectId,
    ownerWorkspaceId: project.workspaceId,
  };
}

async function validateTokenRequest(
  executor: QueryExecutor,
  tokenRequestId: string | null,
  owner: { projectId: string | null; ownerWorkspaceId: string },
) {
  if (!tokenRequestId) return;
  const [tokenRequest] = await executor
    .select({
      id: savedRequests.id,
      projectId: savedRequests.projectId,
      workspaceId: projects.workspaceId,
    })
    .from(savedRequests)
    .innerJoin(projects, eq(projects.id, savedRequests.projectId))
    .where(eq(savedRequests.id, tokenRequestId))
    .limit(1);
  if (
    !tokenRequest ||
    tokenRequest.workspaceId !== owner.ownerWorkspaceId ||
    (owner.projectId && tokenRequest.projectId !== owner.projectId)
  ) {
    throw new AuthDomainError(
      "Token request must belong to the authentication profile scope.",
      "AUTH_TOKEN_REQUEST_INVALID",
    );
  }
}

async function assertNameAvailable(
  executor: QueryExecutor,
  input: {
    workspaceId: string | null;
    projectId: string | null;
    name: string;
    excludeId?: string;
  },
) {
  const conditions = [
    input.workspaceId
      ? eq(authProfiles.workspaceId, input.workspaceId)
      : eq(authProfiles.projectId, input.projectId as string),
    sql`lower(${authProfiles.name}) = lower(${input.name})`,
  ];
  if (input.excludeId) conditions.push(ne(authProfiles.id, input.excludeId));
  const [existing] = await executor
    .select({ id: authProfiles.id })
    .from(authProfiles)
    .where(and(...conditions))
    .limit(1);
  if (existing) {
    throw new AuthDomainError(
      "An authentication profile with this name already exists at this scope.",
      "AUTH_PROFILE_NAME_CONFLICT",
    );
  }
}

function toDetail(
  row: typeof authProfiles.$inferSelect,
  configuration: AuthProfileConfiguration,
  input: { inherited: boolean; overridden: boolean; redact: boolean },
): AuthProfileDetail {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    tokenRequestId: row.tokenRequestId,
    name: row.name,
    type: row.type,
    configuration: input.redact
      ? redactedConfiguration(configuration)
      : configuration,
    inherited: input.inherited,
    overridden: input.overridden,
  };
}

export async function getAuthConfiguration(input: {
  workspaceId: string;
  projectId: string | null;
}): Promise<AuthConfiguration> {
  const database = getDatabase();
  await getWorkspace(database, input.workspaceId);
  if (input.projectId) {
    const project = await getProject(database, input.projectId);
    if (project.workspaceId !== input.workspaceId) {
      throw new AuthDomainError(
        "Project belongs to another workspace.",
        "PROJECT_WORKSPACE_MISMATCH",
      );
    }
  }

  const [profileRows, overrideRows, requestRows] = await Promise.all([
    database
      .select()
      .from(authProfiles)
      .where(
        input.projectId
          ? sql`${authProfiles.workspaceId} = ${input.workspaceId} or ${authProfiles.projectId} = ${input.projectId}`
          : eq(authProfiles.workspaceId, input.workspaceId),
      )
      .orderBy(asc(authProfiles.name)),
    input.projectId
      ? database
          .select()
          .from(authProfileOverrides)
          .where(eq(authProfileOverrides.projectId, input.projectId))
      : Promise.resolve([]),
    database
      .select({
        id: savedRequests.id,
        projectId: savedRequests.projectId,
        name: savedRequests.name,
      })
      .from(savedRequests)
      .innerJoin(projects, eq(projects.id, savedRequests.projectId))
      .where(eq(projects.workspaceId, input.workspaceId))
      .orderBy(asc(savedRequests.name)),
  ]);
  const overrides = new Map(
    overrideRows.map((row) => [row.authProfileId, row]),
  );
  return {
    profiles: profileRows.map((profile) => {
      const base = parseAuthConfiguration(profile.configuration);
      const override = overrides.get(profile.id);
      const effective = override
        ? mergeConfiguration(
            base,
            override.configuration as Partial<AuthProfileConfiguration>,
          )
        : base;
      return toDetail(profile, effective, {
        inherited: Boolean(profile.workspaceId && input.projectId),
        overridden: Boolean(override),
        redact: true,
      });
    }),
    tokenRequests: requestRows,
  };
}

export async function saveAuthProfile(input: {
  id?: string;
  workspaceId: string | null;
  projectId: string | null;
  tokenRequestId: string | null;
  name: string;
  type: typeof authProfiles.$inferInsert.type;
  configuration: AuthProfileConfiguration;
}) {
  const database = getDatabase();
  return database.transaction(async (transaction) => {
    const owner = await validateOwner(
      transaction,
      input.workspaceId,
      input.projectId,
    );
    await validateTokenRequest(transaction, input.tokenRequestId, owner);
    await assertNameAvailable(transaction, { ...input, excludeId: input.id });

    if (input.id) {
      const current = await getProfile(transaction, input.id);
      if (
        current.workspaceId !== owner.workspaceId ||
        current.projectId !== owner.projectId
      ) {
        throw new AuthDomainError(
          "Authentication profile scope cannot be changed.",
        );
      }
      const configuration = mergeConfiguration(
        parseAuthConfiguration(current.configuration),
        input.configuration,
      );
      await transaction
        .update(authProfiles)
        .set({
          name: input.name,
          type: input.type,
          tokenRequestId: input.tokenRequestId,
          configuration,
          updatedAt: new Date(),
        })
        .where(eq(authProfiles.id, input.id));
      await transaction
        .delete(authTokenCache)
        .where(eq(authTokenCache.authProfileId, input.id));
      return { id: input.id };
    }

    const [profile] = await transaction
      .insert(authProfiles)
      .values({
        workspaceId: owner.workspaceId,
        projectId: owner.projectId,
        tokenRequestId: input.tokenRequestId,
        name: input.name,
        type: input.type,
        configuration: input.configuration,
      })
      .returning({ id: authProfiles.id });
    if (!profile)
      throw new AuthDomainError("Authentication profile could not be created.");
    return profile;
  });
}

export async function saveAuthOverride(input: {
  authProfileId: string;
  projectId: string;
  configuration: Partial<AuthProfileConfiguration>;
}) {
  const database = getDatabase();
  const project = await getProject(database, input.projectId);
  const profile = await getProfile(database, input.authProfileId);
  if (profile.workspaceId !== project.workspaceId) {
    throw new AuthDomainError(
      "Only inherited workspace profiles can be overridden.",
    );
  }
  const [existing] = await database
    .select()
    .from(authProfileOverrides)
    .where(
      and(
        eq(authProfileOverrides.authProfileId, input.authProfileId),
        eq(authProfileOverrides.projectId, input.projectId),
      ),
    )
    .limit(1);
  const base = parseAuthConfiguration(profile.configuration);
  const current = existing
    ? mergeConfiguration(
        base,
        existing.configuration as Partial<AuthProfileConfiguration>,
      )
    : base;
  const configuration = mergeConfiguration(current, input.configuration);
  await database
    .insert(authProfileOverrides)
    .values({
      authProfileId: input.authProfileId,
      projectId: input.projectId,
      configuration,
    })
    .onConflictDoUpdate({
      target: [
        authProfileOverrides.authProfileId,
        authProfileOverrides.projectId,
      ],
      set: { configuration, updatedAt: new Date() },
    });
  await database
    .delete(authTokenCache)
    .where(eq(authTokenCache.authProfileId, input.authProfileId));
}

export async function deleteAuthProfile(id: string) {
  const database = getDatabase();
  await getProfile(database, id);
  await database.transaction(async (transaction) => {
    await transaction
      .update(savedRequests)
      .set({ authProfileId: null, updatedAt: new Date() })
      .where(eq(savedRequests.authProfileId, id));
    await transaction.delete(authProfiles).where(eq(authProfiles.id, id));
  });
}

export async function getEffectiveAuthProfile(
  id: string,
  projectId: string,
): Promise<EffectiveAuthProfile> {
  const database = getDatabase();
  const project = await getProject(database, projectId);
  const profile = await getProfile(database, id);
  if (
    profile.projectId !== project.id &&
    profile.workspaceId !== project.workspaceId
  ) {
    throw new AuthDomainError(
      "Authentication profile is not available to this project.",
      "AUTH_PROFILE_SCOPE_INVALID",
    );
  }
  const [override] = profile.workspaceId
    ? await database
        .select()
        .from(authProfileOverrides)
        .where(
          and(
            eq(authProfileOverrides.authProfileId, profile.id),
            eq(authProfileOverrides.projectId, project.id),
          ),
        )
        .limit(1)
    : [];
  const base = parseAuthConfiguration(profile.configuration);
  return toDetail(
    profile,
    override
      ? mergeConfiguration(
          base,
          override.configuration as Partial<AuthProfileConfiguration>,
        )
      : base,
    {
      inherited: Boolean(profile.workspaceId),
      overridden: Boolean(override),
      redact: false,
    },
  );
}

export async function getCachedToken(profileId: string, projectId: string) {
  const [cached] = await getDatabase()
    .select()
    .from(authTokenCache)
    .where(
      and(
        eq(authTokenCache.authProfileId, profileId),
        eq(authTokenCache.projectId, projectId),
      ),
    )
    .limit(1);
  return cached ?? null;
}

export async function saveCachedToken(input: {
  authProfileId: string;
  projectId: string;
  accessToken: string;
  refreshToken: string | null;
  tokenType: string;
  expiresAt: Date | null;
}) {
  await getDatabase()
    .insert(authTokenCache)
    .values(input)
    .onConflictDoUpdate({
      target: [authTokenCache.authProfileId, authTokenCache.projectId],
      set: { ...input, updatedAt: new Date() },
    });
}
