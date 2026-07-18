# Development

## Repository layout

Application routes remain thin. Product UI lives under `src/features`; reusable
business logic belongs in `src/core`; persistence belongs in `src/db`.

Workspace hierarchy validation lives in
`src/features/workspaces/domain.ts`. The production repository under
`src/features/workspaces/data` is marked `server-only`; client components call
its validated Server Action boundary rather than importing database code.

## Setup

```bash
npm ci
docker compose up -d database
cp .env.example .env
npm run db:migrate
npm run dev
```

PostgreSQL integration tests that mutate hierarchy records require an isolated
database URL. Never point `TEST_DATABASE_URL` at a database containing data you
want to preserve.

```bash
TEST_DATABASE_URL=postgresql://workbench:workbench@localhost:5432/workbench_test \
DATABASE_URL=postgresql://workbench:workbench@localhost:5432/workbench_test \
npm run test:integration
```

## Change checklist

- Work on a feature branch linked to a phase issue.
- Read version-matched Next.js documentation under `node_modules/next/dist/docs`
  before using framework APIs.
- Keep client component boundaries narrow.
- Validate all external input with Zod at a server boundary.
- Keep secrets and database modules server-only.
- Add tests at the lowest useful layer.
- Generate and commit forward-only migrations for schema changes.
- Update architecture and operator documentation with behavior changes.
- Run `npm run check` and the affected integration/e2e suites.

## Dependency policy

Use current stable releases and commit the npm lockfile. If an absolute-latest
major violates peer ranges in the latest Next.js toolchain, use the newest
compatible stable release rather than committing an invalid dependency tree.
`npm ls --depth=0`, the production build, the full test matrix, and `npm audit`
must all pass after dependency changes.

## Documentation screenshots

The browser suite owns the product screenshots in `docs/images`. It uses fixed
fake names and the local deterministic mock API so documentation never depends
on, or captures, personal data and public services.

Run it against a fresh isolated PostgreSQL database because the documentation
fixtures deliberately use stable names:

```bash
docker compose exec database createdb -U workbench workbench_screenshots
DATABASE_URL=postgresql://workbench:workbench@localhost:5432/workbench_screenshots \
TEST_DATABASE_URL=postgresql://workbench:workbench@localhost:5432/workbench_screenshots \
npm run db:migrate
DATABASE_URL=postgresql://workbench:workbench@localhost:5432/workbench_screenshots \
TEST_DATABASE_URL=postgresql://workbench:workbench@localhost:5432/workbench_screenshots \
npm run screenshots
```

Review every changed image before committing it. In particular, confirm that no
token, credential, private hostname, customer data, or personal name is visible.
