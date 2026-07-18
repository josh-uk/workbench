import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { primaryId, timestamps } from "./helpers";

export const workspaces = pgTable(
  "workspaces",
  {
    id: primaryId(),
    name: text("name").notNull(),
    description: text("description"),
    position: integer("position").notNull().default(0),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("workspaces_name_unique").on(table.name),
    check("workspaces_name_not_blank", sql`length(trim(${table.name})) > 0`),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: primaryId(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    position: integer("position").notNull().default(0),
    archived: boolean("archived").notNull().default(false),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("projects_workspace_name_unique").on(
      table.workspaceId,
      table.name,
    ),
    index("projects_workspace_position_idx").on(
      table.workspaceId,
      table.position,
    ),
    check("projects_name_not_blank", sql`length(trim(${table.name})) > 0`),
  ],
);

export const folders = pgTable(
  "folders",
  {
    id: primaryId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => folders.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    ...timestamps(),
  },
  (table) => [
    index("folders_project_parent_position_idx").on(
      table.projectId,
      table.parentId,
      table.position,
    ),
    check("folders_name_not_blank", sql`length(trim(${table.name})) > 0`),
    check(
      "folders_not_self_parent",
      sql`${table.parentId} is distinct from ${table.id}`,
    ),
  ],
);
