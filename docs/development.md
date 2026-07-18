# Development

## Repository layout

Application routes remain thin. Product UI lives under `src/features`; reusable
business logic belongs in `src/core`; persistence belongs in `src/db`.

## Setup

```bash
npm ci
docker compose up -d database
cp .env.example .env
npm run db:migrate
npm run dev
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
