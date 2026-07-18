# HTTPie import

The HTTPie adapter uses the shared importer contract. It preserves collection,
folder, request, environment, and authentication metadata where the source export
format provides them. Unsupported fields appear in preview warnings.

Realistic, sanitised fixture exports will cover format detection, nested
collections, variables, authentication, bodies, conflict resolution, and partial
imports. No fixture may contain proprietary domains, schemas, or secrets.
