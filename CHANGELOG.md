# Changelog

All notable changes to Workbench are documented here. Versions follow semantic
versioning.

## 1.1.0 - 2026-07-19

### Added

- UI-managed Microsoft device-code sign-in for a personal Azure account, with
  no user-created Entra application registration or terminal step.
- Azure Key Vault as an optional source for bearer tokens, Basic passwords, API
  keys, OAuth client secrets, OAuth passwords, and OAuth refresh tokens.
- Exact or latest Key Vault secret references, sanitized connection and
  failure states, reference testing, and server-side just-in-time resolution.
- Persistent, isolated Azure CLI authentication state in the standard Docker
  Compose installation.

### Changed

- The standard production and development containers now include Azure CLI
  2.88.0 and use Debian Bookworm while remaining non-root and multi-platform.
- Export manifests now report the package version instead of a stale hard-coded
  value.

### Security

- Key Vault tokens and resolved values remain outside browser responses,
  PostgreSQL, execution history, exports, backups, and application logs.
- Vault references accept only HTTPS Azure Key Vault hosts, preventing access
  tokens from being forwarded to arbitrary servers.
- Azure CLI processes use fixed argument arrays without a shell, bounded output,
  one active login, cancellation, expiry, and sanitized errors.

## 1.0.0 - 2026-07-18

Initial public release.

### Added

- Persistent workspaces, projects, nested folders, saved requests, and search.
- Server-side request execution with SSRF controls, cancellation, bounded
  response capture, history, cookies, outputs, assertions, and timing details.
- Scoped environments and variables with secret taint, masking, and provenance.
- Reusable authentication profiles, OAuth token caching, overrides, and
  request-derived credentials.
- OpenAPI 3.x preview/import/refresh plus HTTPie, Postman, cURL, and raw HTTP
  collection imports.
- Ordered workflows with runtime overrides, assertions, output passing, and
  persistent execution reports.
- Versioned workspace/project exports, encrypted secret payloads, full logical
  backup/restore, automatic schedules, and configurable retention.
- Searchable command palette, keyboard shortcuts, automated WCAG checks, and
  reproducible documentation screenshots.
- Protected CI, multi-architecture Docker images, GHCR publication, SBOM and
  provenance generation, and semantic-version release automation.
