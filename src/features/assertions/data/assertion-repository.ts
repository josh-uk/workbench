import "server-only";

import { asc, eq } from "drizzle-orm";

import {
  assertionDefinitionSchema,
  type AssertionResult,
} from "@/core/assertions/domain";
import { getDatabase } from "@/db/client";
import { assertions } from "@/db/schema";

function parseRows(
  rows: Array<typeof assertions.$inferSelect>,
  owner: AssertionResult["owner"],
) {
  return rows.map((row) => ({
    owner,
    definition: assertionDefinitionSchema.parse({
      id: row.id,
      name: row.name,
      type: row.type,
      configuration: row.configuration,
      enabled: row.enabled,
    }),
  }));
}

export async function getExecutionAssertions(
  requestId: string,
  workflowStepId?: string,
) {
  const database = getDatabase();
  const [requestRows, workflowStepRows] = await Promise.all([
    database
      .select()
      .from(assertions)
      .where(eq(assertions.requestId, requestId))
      .orderBy(asc(assertions.position)),
    workflowStepId
      ? database
          .select()
          .from(assertions)
          .where(eq(assertions.workflowStepId, workflowStepId))
          .orderBy(asc(assertions.position))
      : Promise.resolve([]),
  ]);
  return [
    ...parseRows(requestRows, "request"),
    ...parseRows(workflowStepRows, "workflow_step"),
  ];
}
