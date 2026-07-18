# Importer architecture

Importers separate untrusted source parsing from database preview and execution.
An adapter detects one external syntax and maps it to a bounded portable plan.
The repository previews that plan without mutation, then applies only the
user-approved selection inside one database transaction.

```ts
interface CollectionImporter {
  id: string;
  label: string;
  format: "httpie" | "postman" | "curl" | "raw_http";
  canImport(input: string, parsedJson: unknown | null): boolean;
  parse(input: string): PortableImportPlan;
}
```

The registry currently includes HTTPie 1.x JSON exports, HTTPie CLI commands,
Postman 2.x collections and environments, cURL commands, and raw HTTP request
text. The portable plan contains folders, requests, environments, project
variables, authentication profiles, warnings, unsupported fields, a canonical
source hash, and small format-specific metadata records. Saved requests and the
editor remain independent of every source tool's object model.

Preview reports the workspace/project target and conflicts for folder paths,
request names, environments, variables, and authentication profiles. Execution
supports:

- `replace`: update the conflicting record from the import
- `merge`: preserve unmatched existing fields and apply imported fields with the
  same name
- `rename`: create a uniquely named copy
- `skip`: preserve the existing record and retain an unlinked imported-operation
  audit row

Existing folder paths are always reused. A request already linked to a different
import is never stolen by replace or merge; the new request is renamed and a
warning is recorded. The original source, normalized operation snapshot, source
metadata, selection, warnings, and run summary are retained in the import tables.

JSON parsing is limited to 2 MiB, 80 levels, and 100,000 nodes; prototype keys
are rejected. Commands are tokenized without invoking a shell, and pipelines,
redirects, substitutions, multiple commands, and referenced config files are
blocked. Request, field, variable, configuration, and collection-count limits
are validated before preview.
