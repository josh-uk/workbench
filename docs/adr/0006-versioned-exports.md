# ADR 0006: Versioned export format

Status: Accepted

Logical exports include a manifest schema version. Importers validate and migrate
known older formats before any write. This supports long-lived backups without
binding users to raw database layouts. Secrets are excluded by default.
