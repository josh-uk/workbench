import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { projects } from "./core";
import {
  importFormatEnum,
  importRunStatusEnum,
  importSourceTypeEnum,
} from "./enums";
import { primaryId, timestamps } from "./helpers";

export const importedDefinitions = pgTable(
  "imported_definitions",
  {
    id: primaryId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    format: importFormatEnum("format").notNull(),
    sourceType: importSourceTypeEnum("source_type").notNull(),
    sourceUrl: text("source_url"),
    originalDocument: text("original_document").notNull(),
    version: text("version"),
    title: text("title"),
    apiVersion: text("api_version"),
    metadata: jsonb("metadata").notNull().default({}),
    importedAt: timestamp("imported_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ...timestamps(),
  },
  (table) => [index("imported_definitions_project_idx").on(table.projectId)],
);

export const importedOperations = pgTable(
  "imported_operations",
  {
    id: primaryId(),
    definitionId: uuid("definition_id")
      .notNull()
      .references(() => importedDefinitions.id, { onDelete: "cascade" }),
    sourceKey: text("source_key").notNull(),
    method: text("method").notNull(),
    path: text("path").notNull(),
    operationId: text("operation_id"),
    summary: text("summary"),
    tags: text("tags").array(),
    operation: jsonb("operation").notNull(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("imported_operations_definition_source_unique").on(
      table.definitionId,
      table.sourceKey,
    ),
  ],
);

export const importRuns = pgTable(
  "import_runs",
  {
    id: primaryId(),
    definitionId: uuid("definition_id").references(
      () => importedDefinitions.id,
      { onDelete: "set null" },
    ),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    format: importFormatEnum("format").notNull(),
    status: importRunStatusEnum("status").notNull(),
    summary: jsonb("summary").notNull().default({}),
    warnings: jsonb("warnings").notNull().default([]),
    error: text("error"),
    ...timestamps(),
  },
  (table) => [
    index("import_runs_project_created_idx").on(
      table.projectId,
      table.createdAt,
    ),
  ],
);
