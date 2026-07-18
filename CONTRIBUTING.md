# Contributing to Workbench

## Workflow

1. Start from an up-to-date `master` branch.
2. Create a focused branch such as `phase-3/request-execution`.
3. Keep commits conventional where practical, for example
   `feat(requests): add redirect validation`.
4. Add or update tests and documentation with the implementation.
5. Open a pull request using the repository template and link its phase issue.
6. Merge only after required CI checks and review are complete.

Direct commits to `master` are reserved for unavoidable repository bootstrap.
The repository uses rebase merging and automatically deletes merged branches.
Keep commits reviewable and conventional because their individual identities are
preserved on `master`; do not squash phase pull requests.

## Local quality gate

```bash
npm ci
npm run check
```

Run PostgreSQL integration and Playwright tests when the change affects those
areas:

```bash
docker compose up -d database
cp .env.example .env
npm run db:migrate
npm run test:integration
npm run test:e2e
```

## Database changes

Change the Drizzle schema, run `npm run db:generate`, and commit the schema and
generated migration together. Never rewrite a migration that has shipped on
`master`; add a new forward migration.

## UI changes

Use accessible names, visible focus states, correct semantic elements, keyboard
operation, and sufficient contrast. Include screenshots from the running app
for visible changes. Screenshots and fixtures must use fake data and must not
contain tokens, credentials, internal domains, or customer information.

## Security

Do not put secrets in code, fixtures, issue text, pull requests, logs, exports,
or screenshots. Report vulnerabilities through a private GitHub security
advisory.
