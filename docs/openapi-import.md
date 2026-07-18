# OpenAPI import

OpenAPI 3.x JSON and YAML can be supplied by file, paste, or URL. The parser keeps
the original document, version, title, servers, security schemes, schemas, and
operations as a first-class imported definition.

The preview groups operations by tags, lets users select operations and folder
mapping, proposes server variables and authentication profiles, and reports
unsupported or conflicting fields before writing data.

Refresh compares the stored source with a newly parsed source and reports added,
removed, and changed operations, parameters, bodies, responses, authentication,
servers, and schemas. Applying a refresh never silently deletes custom requests.
