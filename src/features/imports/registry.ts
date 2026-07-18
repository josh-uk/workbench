import type { CollectionImportFormat, PortableImportPlan } from "./domain";
import { CollectionImportError } from "./domain";
import { looksLikeCurl, parseCurlCommand } from "./adapters/curl";
import { looksLikeHttpie, parseHttpieExport } from "./adapters/httpie";
import {
  looksLikeHttpieCommand,
  parseHttpieCommand,
} from "./adapters/httpie-cli";
import { looksLikePostman, parsePostmanExport } from "./adapters/postman";
import { looksLikeRawHttp, parseRawHttpRequest } from "./adapters/raw-http";
import { parseBoundedJson } from "./adapters/utils";

export interface CollectionImporter {
  id: string;
  label: string;
  format: CollectionImportFormat;
  canImport(input: string, parsedJson: unknown | null): boolean;
  parse(input: string): PortableImportPlan;
}

export const collectionImporters: CollectionImporter[] = [
  {
    id: "httpie_export",
    label: "HTTPie workspace or collection",
    format: "httpie",
    canImport: (_input, value) => value !== null && looksLikeHttpie(value),
    parse: parseHttpieExport,
  },
  {
    id: "httpie_cli",
    label: "HTTPie CLI command",
    format: "httpie",
    canImport: (input) => looksLikeHttpieCommand(input),
    parse: parseHttpieCommand,
  },
  {
    id: "postman",
    label: "Postman collection or environment",
    format: "postman",
    canImport: (_input, value) => value !== null && looksLikePostman(value),
    parse: parsePostmanExport,
  },
  {
    id: "curl",
    label: "cURL command",
    format: "curl",
    canImport: (input) => looksLikeCurl(input),
    parse: parseCurlCommand,
  },
  {
    id: "raw_http",
    label: "Raw HTTP request",
    format: "raw_http",
    canImport: (input) => looksLikeRawHttp(input),
    parse: parseRawHttpRequest,
  },
];

function maybeJson(input: string) {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  return parseBoundedJson(input);
}

export function importCollectionSource(
  input: string,
  format: CollectionImportFormat | "auto" = "auto",
) {
  const parsedJson = maybeJson(input);
  const candidates =
    format === "auto"
      ? collectionImporters
      : collectionImporters.filter((importer) => importer.format === format);
  const importer = candidates.find((candidate) =>
    candidate.canImport(input, parsedJson),
  );
  if (!importer) {
    throw new CollectionImportError(
      format === "auto"
        ? "The source is not a recognized HTTPie, Postman, cURL, or raw HTTP import."
        : `The source is not a recognized ${format.replace("_", " ")} import.`,
      "IMPORT_FORMAT_UNKNOWN",
    );
  }
  return importer.parse(input);
}
