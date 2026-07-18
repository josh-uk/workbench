# Data model

The initial Drizzle schema contains 22 relational tables. UUID primary keys make
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

Imported definitions retain the original source document and structured
operation records. Custom saved requests are separate records, so refreshing an
import cannot silently overwrite them.

Response metadata stores bounded previews and structured headers, timing, and
redirect data. Large binary bodies will use explicit retention rules rather than
being stored indefinitely in the main tables.

The generated SQL migration under `drizzle/` is the source of truth for deployed
schema history. Migrations are forward-only after merging to `master`.
