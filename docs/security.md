# Security model

## Local trust boundary

Workbench assumes the host machine and people with access to its local browser
session are trusted. It does not provide application accounts. Do not expose the
app or PostgreSQL port directly to an untrusted network. Use a reverse proxy with
transport security and access control if remote access is required.

## Required controls

- Permit only HTTP and HTTPS outbound protocols.
- Resolve DNS and validate all address results before connection.
- Block loopback, link-local, cloud metadata, and configured private destinations
  by default; validate each redirect independently.
- Limit request bodies, response bodies, redirects, decompression, parser depth,
  archive expansion, and execution time.
- Reject CR/LF header injection and unsafe file paths.
- Parse YAML with safe schema and alias limits.
- Render untrusted HTML only in a tightly sandboxed frame without same-origin or
  navigation privileges.
- Redact authorization headers, API keys, passwords, access and refresh tokens,
  cookies, and marked secret variables before logs or persistence.
- Exclude secrets from exports by default. Password-protected secret export uses
  authenticated encryption with a memory-hard password derivation function.

Disabling TLS verification or enabling access to private destinations is a
per-request or explicit administrator choice and must be visible in the execution
trace.

## Outbound request implementation

The executor validates the protocol, rejects URL-embedded credentials,
resolves every address, blocks mixed public/private DNS answers by default, and
pins the socket to a validated address while retaining the original host for
HTTP Host and TLS SNI. Redirect locations receive the same validation. Metadata
hosts and addresses remain blocked even when a user explicitly enables trusted
private-network access.

Request and response limits are enforced while streaming. Managed framing and
hop-by-hop headers cannot be overridden. Saved execution snapshots redact marked
and well-known sensitive headers, cookies, and sensitive query values; matching
secrets are also removed from textual response previews. Cookie values and
Set-Cookie headers are never persisted in clear text in execution history. The
execution engine does not write request plans, bodies, or response contents to
application logs.

OpenAPI URL imports use the same pinned-address policy and redirect validation as
request execution. They add a 2 MiB source cap, a 15-second timeout,
five-redirect limit, and bounded parsing. URL credentials, non-HTTP protocols,
cloud metadata targets, and unsafe redirects remain blocked even when trusted
local networking is enabled. Posted preview content is not trusted as a way to
bypass validation of its declared source URL.

Variable values are stored only in the local PostgreSQL installation so they
can be reused. The local trust boundary therefore includes database access.
Marked values are password-masked in the normal editor and never returned in
resolution previews, execution snapshots, resolved display URLs, or textual
response history. Secret taint propagates through nested interpolation, and
temporary runtime overrides are never persisted as configuration. Exports omit
secrets by default when the export phase is implemented.

Authentication profiles follow the same local trust model. Secret profile
fields are replaced with a fixed placeholder in browser DTOs, and saving that
placeholder preserves the existing server-side value. Direct OAuth access and
refresh tokens live only in the local database cache and server execution path.
Saved-request token outputs are masked in output views and redacted from response
metadata before persistence. Authentication traces contain profile identity,
credential source, and injection target, but never the credential. Editing a
profile or override invalidates its direct OAuth cache.

## Dependencies and images

CI fails for high-severity npm audit findings. Dependabot monitors npm, Docker,
and GitHub Actions dependencies. Production containers run as a non-root user
and contain only the standalone application, runtime dependencies, migrations,
and public assets.
