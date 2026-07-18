# Testing

## Layers

- Unit tests cover framework-independent core behavior and maintain high
  coverage for security and resolution logic.
- Component tests use React Testing Library and jsdom for accessible user
  interactions.
- Integration tests run repositories, migrations, and execution services against
  PostgreSQL and local mock HTTP services.
- End-to-end tests use Playwright Chromium against the running application.

Tests never call public internet services. Fixtures contain only generic fake
data. Secrets are forbidden in snapshots and screenshots.

Workspace repository tests require `TEST_DATABASE_URL` and truncate only that
isolated database between cases. They cover active-workspace persistence,
ordering, archive state, nested folders, duplication, cascade behavior, naming
conflicts, and cycle rejection. Playwright uses unique workspace and project
names so repeated local runs do not depend on an empty installation.

Request tests cover safe setting defaults, all URL/address policy classes,
metadata blocking, redirect validation, body serialisation, secret redaction,
timeouts, response limits, and cancellation. Serialized integration suites use
the shared disposable PostgreSQL database plus an ephemeral loopback HTTP
server. Browser tests start a separate deterministic mock API and cover request
creation, persistence, execution, response/history inspection, and cancellation
without public network access.

Variable unit tests cover precedence, recursive interpolation, empty and
unresolved values, cycle detection, provenance, and secret taint. Repository
tests cover scope ownership, environment CRUD/duplication, selection validation
and cleanup, and deep-copy remapping. Component and Chromium flows verify masked
previews, temporary overrides, environment selection, real execution, and reload
persistence without exposing the secret echoed by the mock server.

Authentication tests cover bearer, Basic, API-key, OAuth, and request-derived
injection; JSONPath behavior; expiry calculation; cache reuse; refresh-token
regeneration; output persistence; generated-variable reuse; deep-copy ID
remapping; and secret redaction. The Chromium flow creates a saved token request,
publishes a secret expiring output, selects it through a request-derived profile,
sends an authenticated request twice, and verifies that the token request ran
once without its value appearing in the UI or screenshots.

OpenAPI unit tests cover safe JSON/YAML parsing, generated parameters and bodies,
server variables, security mapping, hostile YAML limits, and detailed refresh
diffs. Integration tests cover first-class persistence, rename/replace/skip
conflicts, selective refresh, generated-request customization, variable
preservation, detachment, private-source opt-in, redirect revalidation, metadata
blocking, and source size/protocol limits. The Chromium flow imports a pasted
OpenAPI 3.1 operation and executes the generated request against the local mock
API.

CI runs formatting, linting, strict type checking, unit coverage, component
tests, migration checks, integration tests, a production build, Playwright,
container build, and a high-severity dependency audit. Failure artifacts include
coverage and Playwright traces or screenshots where relevant.
