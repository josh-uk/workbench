# ADR 0003: Imported definitions are first-class

Status: Accepted

Imported API definitions retain their source and structured operations instead
of being irreversibly flattened into saved requests. This enables previews,
metadata preservation, refresh diffs, and selective updates. Custom requests are
separate records and cannot be overwritten by refresh.
