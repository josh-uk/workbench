# Workbench

Workbench is a local-first, project-oriented API client for saved requests,
reusable authentication, OpenAPI imports, and developer workflows. It is built
for developers who want the structure of a project workspace without tying
their API collections to a Git repository or a hosted account.

> Workbench is under active development. Workspace organisation, saved request
> editing, scoped environments and variables, reusable authentication, request
> outputs, server-side execution, response inspection, bounded history, ordered
> workflows, no-code assertions, and versioned backup/restore are functional;
> release polish is delivered through the remaining numbered phase issue.

## Why Workbench

- Organise APIs into manually created workspaces, projects, folders, and saved
  requests.
- Execute requests from the server runtime, avoiding browser CORS limitations.
- Resolve scoped environments and variables with visible provenance.
- Reuse authentication and extracted request outputs across requests.
- Preserve OpenAPI definitions as refreshable first-class records.
- Import HTTPie, Postman, cURL, and raw HTTP sources through one preview flow.
- Chain saved requests in ordered workflows with output passing and assertions.
- Keep application data in a local PostgreSQL database with documented export
  and backup formats.

## Technology

- Next.js 16, React 19, and strict TypeScript
- Tailwind CSS 4 and shadcn-compatible Radix UI components
- PostgreSQL 18 and Drizzle ORM
- Zod validation
- Vitest, React Testing Library, and Playwright
- Docker, Docker Compose, and GitHub Actions

## Current interface

![Workbench workspace and project management](docs/images/phase-2-workspace-management.png)

The interface reads workspaces, projects, nested folders, saved requests,
execution counts, and active-workspace selection from PostgreSQL. The request
editor persists query parameters, headers, cookies, all planned body modes, and
per-request safety settings. Workspace and project variable managers provide
reusable environments, secret masking, request overrides, temporary one-run
values, and a provenance-aware resolution preview. Workspace/project
authentication profiles support static credentials, OAuth token caching and
refresh, field-level project overrides, and saved token requests. Named JSONPath
outputs feed later requests as generated variables with expiry and secret
redaction. Server-side execution supports cancellation and a response viewer for
formatted/raw bodies, headers, redacted cookies, outputs, timing, request
snapshots, downloads, and history. OpenAPI 3.x JSON/YAML imports provide a
read-only preview, operation/tag selection, executable generated requests,
security and server-variable mapping, selective refresh diffs, and explicit
custom-request protection.
Portable collection imports detect HTTPie 1.x workspace, collection, request,
and environment exports; HTTPie CLI and cURL commands; Postman 2.x collections
and environments; and raw HTTP requests. Every source is previewed with its
target, supported records, warnings, and naming conflicts before a transactional
replace, merge, rename, or skip operation.
Ordered workflows reuse the same saved-request executor as individual sends.
Each step can override runtime variables, add step-only assertions, stop or
continue after failure, and pass generated outputs to later steps. Request and
workflow reports retain individual assertion results without recording actual
matched values.
The Settings view exports workspaces and projects as versioned ZIP archives,
imports them with remapped IDs, creates full logical backups, restores full
backups atomically, and configures automatic backup and request-history
retention. Secret values are excluded unless encrypted or explicitly exported
as plain text.
Documentation screenshots are captured from the real application with generic
data and must never contain secrets.

## Quick start

Prerequisites: Docker Desktop or Docker Engine with Compose.

```bash
docker compose up -d
```

Open [http://localhost:3000](http://localhost:3000). Check container state with:

```bash
docker compose ps
docker compose logs -f app
```

Stop the stack without deleting persisted data:

```bash
docker compose down
```

The `workbench_postgres_data` and `workbench_backups` named volumes preserve
PostgreSQL data and logical backups across restarts. Deleting either volume is
destructive and is intentionally not part of the normal shutdown command.

## Local development

Prerequisites: Node.js 24, npm 11, Docker, and Docker Compose.

```bash
npm ci
docker compose up -d database
cp .env.example .env
npm run db:migrate
npm run dev
```

For a containerised development server with bind-mounted source:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

### Environment variables

| Name                        | Purpose                                        | Default in Compose                   |
| --------------------------- | ---------------------------------------------- | ------------------------------------ |
| `DATABASE_URL`              | Server-only PostgreSQL connection URL          | Generated from the PostgreSQL values |
| `POSTGRES_DB`               | Local database name                            | `workbench`                          |
| `POSTGRES_USER`             | Local database user                            | `workbench`                          |
| `POSTGRES_PASSWORD`         | Local database password                        | `workbench`                          |
| `POSTGRES_PORT`             | Loopback-only database port                    | `5432`                               |
| `APP_PORT`                  | Host port mapped to the app                    | `3000`                               |
| `WORKBENCH_BACKUP_DIR`      | Server-only logical backup directory           | `/backups`                           |
| `WORKBENCH_BACKUP_PASSWORD` | Password for encrypted automatic backups (12+) | Empty                                |

The Compose defaults are development-only credentials. Set unique values if the
database is exposed beyond the local Docker network. Never use a `NEXT_PUBLIC_`
variable for secrets.

## Commands

| Command                    | Purpose                                   |
| -------------------------- | ----------------------------------------- |
| `npm run dev`              | Start the local development server        |
| `npm run build`            | Build the production application          |
| `npm run format:check`     | Check formatting                          |
| `npm run lint`             | Run ESLint with no warnings allowed       |
| `npm run typecheck`        | Generate route types and check TypeScript |
| `npm test`                 | Run unit and component tests              |
| `npm run test:integration` | Run PostgreSQL integration tests          |
| `npm run test:e2e`         | Run Playwright browser tests              |
| `npm run db:generate`      | Generate a Drizzle SQL migration          |
| `npm run db:check`         | Validate migration consistency            |
| `npm run db:migrate`       | Apply committed migrations                |
| `npm run check`            | Run the primary local quality gate        |

## Architecture

Workbench is one self-hosted Next.js application backed by PostgreSQL. Browser
code is limited to UI and interaction; database access, secrets, imports, and
outbound HTTP execution stay in the server runtime.

```text
Browser
  ↓
Next.js application
  ├── App Router UI and server endpoints
  ├── Core domain modules
  ├── HTTP and authentication engines
  ├── Import adapters and workflow runner
  └── Drizzle repositories
        ↓
    PostgreSQL
```

See [Architecture](docs/architecture.md), [Data model](docs/data-model.md),
[Workspace management](docs/workspace-management.md),
[Request execution](docs/request-execution.md), and
[OpenAPI import](docs/openapi-import.md),
[Importer architecture](docs/importers.md), and
[HTTPie import](docs/httpie-import.md), and
[Workflows and assertions](docs/workflows-and-assertions.md).

## Testing and security

Tests do not depend on public internet services. Integration and browser tests
use local PostgreSQL and deterministic mock APIs as features are implemented.
The CI pipeline checks formatting, linting, types, unit coverage, components,
migrations, integration behavior, browser flows, the production build, the
container image, and high-severity dependency vulnerabilities.

Workbench is local-first, not security-free. The request engine is designed to
restrict protocols, validate redirects, block cloud metadata destinations,
limit payloads, and redact secrets. Read the [security model](docs/security.md)
before exposing Workbench outside a trusted machine.

## Data export, backup, and upgrades

Versioned workspace/project export, import, automatic full backup, atomic
restore, and retention are available from Settings. Their format and operational
steps are documented in [Backup and restore](docs/backup-and-restore.md). Do not
treat raw PostgreSQL volume copies from a running database as a supported backup.

## Container images and releases

Merges to `master` publish multi-platform images to:

```text
ghcr.io/josh-uk/workbench
```

Images are tagged with `latest` and the full Git commit SHA. Semantic version
tags such as `v1.0.0` also create versioned images and a GitHub release. This
repository is public; GitHub Container Registry package visibility is managed
separately by the repository owner.

## Contributing

All meaningful changes use feature branches and pull requests. Read
[CONTRIBUTING.md](CONTRIBUTING.md) before making a change. Report security
problems through a private GitHub security advisory, not a public issue.

## Licence

[MIT](LICENSE)
