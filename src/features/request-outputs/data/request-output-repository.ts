import "server-only";

import { and, asc, desc, eq } from "drizzle-orm";

import { maskSecret } from "@/core/secrets/redaction";
import { getDatabase } from "@/db/client";
import {
  requestOutputDefinitions,
  runtimeOutputs,
  savedRequests,
} from "@/db/schema";
import type { EngineResponse } from "@/features/requests/execution/http-engine";
import type { VariableValue } from "@/features/variables/domain";

import type { ExtractedRequestOutput } from "../domain";
import { extractRequestOutputs, parseJsonResponse } from "../extraction";

export async function getLatestGeneratedVariables(
  projectId: string,
): Promise<VariableValue[]> {
  const rows = await getDatabase()
    .select({
      name: requestOutputDefinitions.name,
      value: runtimeOutputs.value,
      secret: runtimeOutputs.secret,
      expiresAt: runtimeOutputs.expiresAt,
    })
    .from(runtimeOutputs)
    .innerJoin(
      requestOutputDefinitions,
      eq(requestOutputDefinitions.id, runtimeOutputs.definitionId),
    )
    .innerJoin(
      savedRequests,
      eq(savedRequests.id, requestOutputDefinitions.requestId),
    )
    .where(eq(savedRequests.projectId, projectId))
    .orderBy(desc(runtimeOutputs.createdAt));
  const now = Date.now();
  const selected = new Map<string, VariableValue>();
  for (const row of rows) {
    if (row.expiresAt && row.expiresAt.getTime() <= now) continue;
    const key = row.name.toLocaleLowerCase();
    if (!selected.has(key)) {
      selected.set(key, {
        name: row.name,
        value: row.value,
        secret: row.secret,
        enabled: true,
      });
    }
  }
  return [...selected.values()];
}

export async function getLatestRequestOutput(requestId: string, name: string) {
  const rows = await getDatabase()
    .select({
      value: runtimeOutputs.value,
      secret: runtimeOutputs.secret,
      expiresAt: runtimeOutputs.expiresAt,
      createdAt: runtimeOutputs.createdAt,
    })
    .from(runtimeOutputs)
    .innerJoin(
      requestOutputDefinitions,
      eq(requestOutputDefinitions.id, runtimeOutputs.definitionId),
    )
    .where(
      and(
        eq(requestOutputDefinitions.requestId, requestId),
        eq(requestOutputDefinitions.name, name),
      ),
    )
    .orderBy(desc(runtimeOutputs.createdAt));
  return (
    rows.find(
      (row) => !row.expiresAt || row.expiresAt.getTime() > Date.now() + 30_000,
    ) ?? null
  );
}

export async function persistRequestOutputs(input: {
  requestId: string;
  executionId: string;
  rawBody: string | null;
  knownSecrets?: readonly string[];
}) {
  const definitions = await getDatabase()
    .select()
    .from(requestOutputDefinitions)
    .where(eq(requestOutputDefinitions.requestId, input.requestId))
    .orderBy(asc(requestOutputDefinitions.position));
  if (!definitions.length) return [];
  const document = parseJsonResponse(input.rawBody ?? "");
  const knownSecrets = (input.knownSecrets ?? []).filter(Boolean);
  const outputs = extractRequestOutputs(document, definitions).filter(
    (output) =>
      !knownSecrets.some(
        (secret) =>
          output.value.includes(secret) ||
          output.value.includes(encodeURIComponent(secret)),
      ),
  );
  if (!outputs.length) return [];
  await getDatabase()
    .insert(runtimeOutputs)
    .values(
      outputs.map((output) => ({
        definitionId: output.definitionId,
        executionId: input.executionId,
        value: output.value,
        secret: output.secret,
        expiresAt: output.expiresAt,
      })),
    );
  return outputs;
}

function redact(value: string, outputs: ExtractedRequestOutput[]) {
  return outputs
    .filter((output) => output.secret && output.value.length >= 3)
    .reduce(
      (result, output) =>
        result.split(output.value).join(maskSecret(output.value)),
      value,
    );
}

export function redactExtractedOutputs(
  response: EngineResponse,
  outputs: ExtractedRequestOutput[],
): EngineResponse {
  return {
    ...response,
    rawBody: response.rawBody,
    bodyPreview: redact(response.bodyPreview, outputs),
    headers: response.headers.map((header) => ({
      ...header,
      value: redact(header.value, outputs),
    })),
  };
}
