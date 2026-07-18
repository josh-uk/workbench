import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { projects, workspaces } from "./core";
import { authTypeEnum, variableScopeEnum } from "./enums";
import { primaryId, timestamps } from "./helpers";
import { savedRequests } from "./requests";

export const environments = pgTable(
  "environments",
  {
    id: primaryId(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    description: text("description"),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("environments_workspace_project_name_unique").on(
      table.workspaceId,
      table.projectId,
      table.name,
    ),
    index("environments_workspace_project_idx").on(
      table.workspaceId,
      table.projectId,
    ),
    check("environments_name_not_blank", sql`length(trim(${table.name})) > 0`),
  ],
);

export const variables = pgTable(
  "variables",
  {
    id: primaryId(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, {
      onDelete: "cascade",
    }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    environmentId: uuid("environment_id").references(() => environments.id, {
      onDelete: "cascade",
    }),
    requestId: uuid("request_id").references(() => savedRequests.id, {
      onDelete: "cascade",
    }),
    scope: variableScopeEnum("scope").notNull(),
    name: text("name").notNull(),
    value: text("value").notNull().default(""),
    secret: boolean("secret").notNull().default(false),
    enabled: boolean("enabled").notNull().default(true),
    ...timestamps(),
  },
  (table) => [
    index("variables_resolution_idx").on(
      table.workspaceId,
      table.projectId,
      table.environmentId,
      table.requestId,
      table.name,
    ),
    check("variables_name_not_blank", sql`length(trim(${table.name})) > 0`),
    check(
      "variables_has_owner",
      sql`num_nonnulls(${table.workspaceId}, ${table.projectId}, ${table.environmentId}, ${table.requestId}) > 0`,
    ),
  ],
);

export const authProfiles = pgTable(
  "auth_profiles",
  {
    id: primaryId(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, {
      onDelete: "cascade",
    }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    tokenRequestId: uuid("token_request_id").references(
      () => savedRequests.id,
      {
        onDelete: "set null",
      },
    ),
    name: text("name").notNull(),
    type: authTypeEnum("type").notNull().default("none"),
    configuration: jsonb("configuration").notNull().default({}),
    ...timestamps(),
  },
  (table) => [
    index("auth_profiles_workspace_project_idx").on(
      table.workspaceId,
      table.projectId,
    ),
    check("auth_profiles_name_not_blank", sql`length(trim(${table.name})) > 0`),
    check(
      "auth_profiles_one_owner",
      sql`num_nonnulls(${table.workspaceId}, ${table.projectId}) = 1`,
    ),
  ],
);

export const authProfileOverrides = pgTable(
  "auth_profile_overrides",
  {
    id: primaryId(),
    authProfileId: uuid("auth_profile_id")
      .notNull()
      .references(() => authProfiles.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    configuration: jsonb("configuration").notNull().default({}),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("auth_profile_overrides_profile_project_unique").on(
      table.authProfileId,
      table.projectId,
    ),
  ],
);
