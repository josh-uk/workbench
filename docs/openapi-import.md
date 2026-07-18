# OpenAPI import

OpenAPI 3.x JSON and YAML can be supplied by file, paste, or URL from **Imported
definitions** inside a project. URL imports can explicitly opt into a trusted
local-machine or Docker-network source. The same opt-in is carried to generated
requests so local API definitions remain executable without weakening the
default network policy.

## Preview and apply

Preview is read-only and reports the API title/version, servers, supported
security schemes, warnings, and request conflicts. Operations are grouped by
tag. Before applying the transaction, choose the operations, tag-to-folder
mapping, definition name, server variable, authentication-profile generation,
and request conflict strategy:

- **Rename** keeps an existing request and gives the generated request a unique
  name.
- **Replace** replaces a reviewed custom request, but never takes a request
  already owned by another imported operation.
- **Skip** records the operation without creating a linked request.

The parser maps path placeholders to request variables, query/header parameters
to request fields, and JSON, form-encoded, multipart, text, or XML request bodies
to the matching editor mode. It proposes API-key, Basic, bearer, OAuth client
credentials, and OAuth password profiles when representable by Workbench.
Unsupported schemes and external references are retained as warnings rather than
fetched implicitly.

The original document, source hash/type/URL, OpenAPI and API versions, servers,
tags, security definitions, schemas, operation snapshots, generated-request
hashes, and import-run history are retained as a first-class definition.

## Refresh and customization

Refresh reparses a source and shows selective changes for added/removed
operations, parameters, bodies, responses, authentication, servers, security
schemes, and schemas. Unmodified generated requests can be updated or removed by
an approved change. Requests changed in the editor are marked customized,
unselected by default, and never overwritten or deleted silently.

Use **Save as custom request** in the request editor to detach a generated
request permanently. A server variable created by an import is updated on
refresh only while its value remains unchanged; developer edits are preserved
with a warning.

## Input safety

Documents are limited to 2 MiB and 2,000 operations. YAML uses the YAML 1.2 core
schema with unique string keys, merge keys disabled, bounded aliases, and
document depth/node limits. Prototype keys are rejected. Only local JSON Pointer
references are resolved.

URL loading allows HTTP and HTTPS without embedded credentials, pins the request
to a validated DNS result, revalidates every redirect, enforces time/size and
redirect limits, and always blocks cloud metadata targets. Private or loopback
destinations require the explicit trusted-network option.
