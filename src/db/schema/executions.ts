import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { projects } from "./core";
import { executionStatusEnum } from "./enums";
import { primaryId, timestamps } from "./helpers";
import { requestOutputDefinitions, savedRequests } from "./requests";

export const requestExecutions = pgTable(
  "request_executions",
  {
    id: primaryId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    requestId: uuid("request_id").references(() => savedRequests.id, {
      onDelete: "set null",
    }),
    status: executionStatusEnum("status").notNull().default("pending"),
    method: text("method").notNull(),
    resolvedUrl: text("resolved_url").notNull(),
    requestSnapshot: jsonb("request_snapshot").notNull(),
    error: jsonb("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    index("request_executions_project_created_idx").on(
      table.projectId,
      table.createdAt,
    ),
    index("request_executions_request_created_idx").on(
      table.requestId,
      table.createdAt,
    ),
  ],
);

export const responseMetadata = pgTable(
  "response_metadata",
  {
    id: primaryId(),
    executionId: uuid("execution_id")
      .notNull()
      .references(() => requestExecutions.id, { onDelete: "cascade" }),
    statusCode: integer("status_code"),
    statusText: text("status_text"),
    durationMs: integer("duration_ms"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    headers: jsonb("headers").notNull().default([]),
    cookies: jsonb("cookies").notNull().default([]),
    redirects: jsonb("redirects").notNull().default([]),
    bodyPreview: text("body_preview"),
    bodyTruncated: boolean("body_truncated").notNull().default(false),
    contentType: text("content_type"),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("response_metadata_execution_unique").on(table.executionId),
  ],
);

export const runtimeOutputs = pgTable(
  "runtime_outputs",
  {
    id: primaryId(),
    definitionId: uuid("definition_id")
      .notNull()
      .references(() => requestOutputDefinitions.id, { onDelete: "cascade" }),
    executionId: uuid("execution_id")
      .notNull()
      .references(() => requestExecutions.id, { onDelete: "cascade" }),
    value: text("value").notNull(),
    secret: boolean("secret").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    index("runtime_outputs_definition_created_idx").on(
      table.definitionId,
      table.createdAt,
    ),
  ],
);
