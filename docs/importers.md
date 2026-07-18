# Importer architecture

Importers implement detection, preview, and execution as separate operations.
Preview must not mutate application data. Execution applies a user-approved plan
inside a database transaction.

```ts
interface CollectionImporter {
  canImport(input: ImportInput): Promise<boolean>;
  preview(input: ImportInput): Promise<ImportPreview>;
  execute(input: ImportInput, options: ImportOptions): Promise<ImportResult>;
}
```

The internal model records source metadata without depending on the source
tool's object model. Conflict handling supports replace, merge, rename, and skip.
All parsers enforce size and complexity limits. Archive extraction rejects
absolute paths, parent traversal, links, and zip-slip destinations.
