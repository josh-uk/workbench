import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";

import { projects } from "./core";
import { assertionTypeEnum, workflowFailureModeEnum } from "./enums";
import { primaryId, timestamps } from "./helpers";
import { savedRequests } from "./requests";

export const workflows = pgTable(
  "workflows",
  {
    id: primaryId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    ...timestamps(),
  },
  (table) => [
    index("workflows_project_idx").on(table.projectId),
    check("workflows_name_not_blank", sql`length(trim(${table.name})) > 0`),
  ],
);

export const workflowSteps = pgTable(
  "workflow_steps",
  {
    id: primaryId(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    requestId: uuid("request_id")
      .notNull()
      .references(() => savedRequests.id, { onDelete: "restrict" }),
    name: text("name"),
    position: integer("position").notNull(),
    failureMode: workflowFailureModeEnum("failure_mode")
      .notNull()
      .default("stop"),
    enabled: boolean("enabled").notNull().default(true),
    runtimeOverrides: jsonb("runtime_overrides").notNull().default({}),
    ...timestamps(),
  },
  (table) => [
    index("workflow_steps_workflow_position_idx").on(
      table.workflowId,
      table.position,
    ),
  ],
);

export const assertions = pgTable(
  "assertions",
  {
    id: primaryId(),
    requestId: uuid("request_id").references(() => savedRequests.id, {
      onDelete: "cascade",
    }),
    workflowStepId: uuid("workflow_step_id").references(
      () => workflowSteps.id,
      { onDelete: "cascade" },
    ),
    type: assertionTypeEnum("type").notNull(),
    configuration: jsonb("configuration").notNull(),
    position: integer("position").notNull().default(0),
    enabled: boolean("enabled").notNull().default(true),
    ...timestamps(),
  },
  (table) => [
    index("assertions_request_position_idx").on(
      table.requestId,
      table.position,
    ),
    index("assertions_workflow_step_position_idx").on(
      table.workflowStepId,
      table.position,
    ),
    check(
      "assertions_one_owner",
      sql`num_nonnulls(${table.requestId}, ${table.workflowStepId}) = 1`,
    ),
  ],
);
