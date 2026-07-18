import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { folders, projects } from "./core";
import { httpMethodEnum, requestBodyTypeEnum } from "./enums";
import { primaryId, timestamps } from "./helpers";

export const savedRequests = pgTable(
  "saved_requests",
  {
    id: primaryId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    folderId: uuid("folder_id").references(() => folders.id, {
      onDelete: "set null",
    }),
    authProfileId: uuid("auth_profile_id"),
    name: text("name").notNull(),
    description: text("description"),
    method: httpMethodEnum("method").notNull().default("GET"),
    url: text("url").notNull(),
    position: integer("position").notNull().default(0),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    settings: jsonb("settings").notNull().default({}),
    ...timestamps(),
  },
  (table) => [
    index("saved_requests_project_folder_position_idx").on(
      table.projectId,
      table.folderId,
      table.position,
    ),
    index("saved_requests_name_idx").on(table.name),
    check(
      "saved_requests_name_not_blank",
      sql`length(trim(${table.name})) > 0`,
    ),
    check("saved_requests_url_not_blank", sql`length(trim(${table.url})) > 0`),
  ],
);

export const requestHeaders = pgTable(
  "request_headers",
  {
    id: primaryId(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => savedRequests.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    value: text("value").notNull().default(""),
    enabled: boolean("enabled").notNull().default(true),
    secret: boolean("secret").notNull().default(false),
    position: integer("position").notNull().default(0),
    ...timestamps(),
  },
  (table) => [
    index("request_headers_request_position_idx").on(
      table.requestId,
      table.position,
    ),
  ],
);

export const requestQueryParameters = pgTable(
  "request_query_parameters",
  {
    id: primaryId(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => savedRequests.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    value: text("value").notNull().default(""),
    enabled: boolean("enabled").notNull().default(true),
    position: integer("position").notNull().default(0),
    ...timestamps(),
  },
  (table) => [
    index("request_query_parameters_request_position_idx").on(
      table.requestId,
      table.position,
    ),
  ],
);

export const requestBodies = pgTable(
  "request_bodies",
  {
    id: primaryId(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => savedRequests.id, { onDelete: "cascade" }),
    type: requestBodyTypeEnum("type").notNull().default("none"),
    content: text("content"),
    contentType: text("content_type"),
    metadata: jsonb("metadata").notNull().default({}),
    ...timestamps(),
  },
  (table) => [uniqueIndex("request_bodies_request_unique").on(table.requestId)],
);

export const requestOutputDefinitions = pgTable(
  "request_output_definitions",
  {
    id: primaryId(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => savedRequests.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    jsonPath: text("json_path").notNull(),
    expiresInJsonPath: text("expires_in_json_path"),
    secret: boolean("secret").notNull().default(false),
    position: integer("position").notNull().default(0),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("request_outputs_request_name_unique").on(
      table.requestId,
      table.name,
    ),
    index("request_outputs_request_position_idx").on(
      table.requestId,
      table.position,
    ),
  ],
);
