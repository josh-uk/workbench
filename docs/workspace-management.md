# Workspace and project management

Phase 2 replaces the foundation mockup with persisted navigation and hierarchy
management.

## Supported operations

- Create, select, rename, duplicate, and delete workspaces.
- Create, rename, duplicate, reorder, archive, restore, and delete projects.
- Create root folders and nested subfolders.
- Rename, reorder, reparent, and delete folder trees.
- Search project and folder names, including nested folder descendants.
- Collapse folder trees and the full project sidebar with keyboard-accessible
  controls.

The active workspace is installation-wide because Workbench is currently a
single-user local application. Project selection is client-local and falls back
to the first active project when data changes.

## Validation and consistency

All mutations cross a Zod-validated Server Action and a server-only repository.
Repository transactions keep active selection, ordering swaps, duplication,
and hierarchy changes consistent. Folder reparenting verifies that the target
belongs to the same project and walks descendants before accepting a move.

Deleting a workspace or project removes its owned records through database
foreign keys. Deleting a folder removes nested folders but preserves saved
requests by moving them to the project root.

Workspace and project duplication copies folder structure plus saved request
headers, query parameters, bodies, tags, settings, request variables, base
variables, and environments. The transaction remaps folder IDs, environment IDs,
and saved selections; project copies retain valid inherited workspace
environment selections while workspace copies receive new workspace-owned IDs.

## Testing

Framework-independent tests cover validation, copy naming, and tree building.
Repository tests run against isolated PostgreSQL. Component tests cover empty
and populated navigation states. Playwright drives the real UI through create,
rename, archive, restore, search, nested-folder, theme, and reload-persistence
flows.
