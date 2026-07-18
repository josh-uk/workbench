# Data model

The Drizzle schema contains 23 relational tables. UUID primary keys make
versioned export and restore safer across installations. All primary records
include timezone-aware creation and update timestamps.

## Ownership hierarchy

```text
Workspace
├── Environments
├── Variables
├── Authentication profiles
└── Projects
    ├── Folders
    ├── Saved requests and request parts
    ├── Environments and variable overrides
    ├── Imported definitions and operations
    ├── Workflows and assertions
    └── Request executions and outputs
```

Foreign keys use cascading deletion only when the child has no meaning outside
its parent. Historical executions preserve a nullable request reference so a
deleted request does not invalidate the entire project history. Workflow steps
restrict request deletion until the workflow is updated.

Workspace and project names are unique in their scope. The repository adds a
case-insensitive availability check so names that differ only by casing cannot
be created through the application. Folder names are unique among siblings at
the application boundary. Folder moves verify project ownership and reject
self-parenting and descendant cycles before changing the parent reference.

Deleting a workspace or project cascades through its owned hierarchy. Deleting
a folder cascades through nested folders, while saved requests in those folders
survive with a `NULL` folder reference and appear at the project root. The
single-user active workspace is stored as the
`navigation.activeWorkspaceId` application setting and falls back to the first
ordered workspace when its target no longer exists.

Saved request components are separate rows for ordered headers, query
parameters, and the single body. Per-request execution controls and cookies use
the request's typed JSON settings. Selected workspace and project environment
IDs live in the same typed settings object, while reusable values stay in the
normalized `variables` and `environments` tables. Request variables are owned by
the saved request and temporary runtime overrides are never persisted. Moving a
request verifies folder/project ownership and gives it the next position in the
destination. Project and workspace duplication now deep-copies folder IDs plus
saved request headers, parameters, bodies, tags, settings, variable scopes,
environments, and request variables while remapping every environment selection.
Authentication profiles, project overrides, selected profile IDs, saved token
request IDs, and output definitions are also deep-copied and remapped. Live
token caches, runtime output values, and execution history are not copied.

Execution history keeps an immutable redacted request snapshot and an optional
one-to-one response metadata row. Deleting a saved request sets the history
reference to `NULL`, preserving project diagnostics. Application-level
retention keeps the latest 100 executions per project; response body previews
are bounded separately from the network response-size limit.

Authentication profile configuration uses validated JSON so profile types can
evolve without a sparse table for every credential field. `auth_token_cache`
stores the latest access token, optional refresh token, token type, and expiry
for a profile. Request output definitions are normalized children of saved
requests; extracted runtime values reference both their definition and source
execution. Secret values are masked at every browser and history boundary, but
the local database remains part of the documented trust boundary.

Imported definitions retain the original source document, source hash/type/URL,
version metadata, and structured server, security, schema, tag, and option
metadata. Imported operations retain their parsed snapshot and operation hash,
plus an optional unique link to the generated saved request and the hash of its
last generated state. Comparing that hash with the live request detects editor
customization. Import runs keep the exact source document/hash, selected change
set, summary, and warnings for initial imports and refreshes. Detaching a request
clears its operation link without deleting either record, so refreshing an
import cannot silently overwrite a custom request.

The same import tables store portable collection sources with one of the
`httpie`, `postman`, `curl`, or `raw_http` formats. Their imported-operation JSON
contains the normalized portable request plus a bounded `sourceMetadata` map.
The generated request still uses the standard normalized request, header, query,
body, variable, settings, environment, and authentication tables. This keeps
conflict handling and source traceability without coupling normal editing or
execution to HTTPie or Postman schemas.

Response metadata stores bounded previews and structured headers, timing, and
redirect data. Large binary bodies will use explicit retention rules rather than
being stored indefinitely in the main tables.

The generated SQL migration under `drizzle/` is the source of truth for deployed
schema history. Migrations are forward-only after merging to `master`.
