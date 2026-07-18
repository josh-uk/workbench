# ADR 0006: Versioned export format

Status: Implemented

Logical exports include a manifest schema version. Importers validate and migrate
known older formats before any write. This supports long-lived backups without
binding users to raw database layouts. Secrets are excluded by default.

Version 1 is a ZIP containing `manifest.json`, `data.json`, and an optional
`secrets.json` or `secrets.json.enc`. SHA-256 checksums bind every declared
payload. The importer rejects unknown versions, undeclared paths, oversized
files, invalid record counts, and relationship failures before committing data.
