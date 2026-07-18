import {
  evaluateJsonPath,
  JsonPathError,
  outputValueToString,
} from "@/core/request-outputs/json-path";
import { calculateTokenExpiry } from "@/features/authentication/injection";

import {
  type ExtractedRequestOutput,
  RequestOutputDomainError,
} from "./domain";

export function parseJsonResponse(rawBody: string) {
  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    throw new RequestOutputDomainError(
      "Request outputs require a valid JSON response body.",
      "OUTPUT_RESPONSE_NOT_JSON",
    );
  }
}

export function extractRequestOutputs(
  document: unknown,
  definitions: Array<{
    id: string;
    name: string;
    jsonPath: string;
    expiresInJsonPath: string | null;
    secret: boolean;
  }>,
  now = new Date(),
): ExtractedRequestOutput[] {
  return definitions.map((definition) => {
    try {
      const value = outputValueToString(
        evaluateJsonPath(document, definition.jsonPath),
      );
      const expiresIn = definition.expiresInJsonPath
        ? evaluateJsonPath(document, definition.expiresInJsonPath)
        : null;
      return {
        definitionId: definition.id,
        name: definition.name,
        jsonPath: definition.jsonPath,
        expiresInJsonPath: definition.expiresInJsonPath,
        secret: definition.secret,
        value,
        expiresAt: calculateTokenExpiry(expiresIn, now),
      };
    } catch (error) {
      const message =
        error instanceof JsonPathError || error instanceof Error
          ? error.message
          : "Output could not be extracted.";
      throw new RequestOutputDomainError(
        `Output ${definition.name} failed: ${message}`,
        "OUTPUT_EXTRACTION_FAILED",
      );
    }
  });
}
