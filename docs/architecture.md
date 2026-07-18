# Architecture

## Context

Workbench is a single-user, local-first application. It has no application-level
accounts. The browser connects to a self-hosted Next.js server, and the server
persists data in PostgreSQL and performs outbound HTTP requests.

## Boundaries

- `src/app` defines routes, layouts, and thin server endpoints.
- `src/components` contains shared UI primitives.
- `src/features` contains product-area UI and application orchestration.
- `src/core` contains framework-independent domain behavior.
- `src/db` contains the Drizzle schema, connection management, and repositories.
- `src/lib` contains narrow cross-cutting utilities and runtime configuration.
- `src/test` and `tests/e2e` contain integration and browser harnesses.

Core modules must not import React, Next.js route handlers, or concrete database
clients. Route handlers validate input, call application services, and translate
results to HTTP responses. Database and secret-bearing modules import
`server-only` where they could otherwise cross a client boundary.

## Runtime

The production container starts by applying committed database migrations, then
launches the Next.js standalone server as a non-root user. Compose waits for
PostgreSQL health before starting the app. `/api/health` verifies both the server
and database connection.

## Major subsystems

- Workspace and project repositories
- Saved-request editor and persistence
- Variable resolver
- Authentication and request-output engine
- SSRF-aware HTTP execution engine
- Modular collection importers
- Workflow and assertion runner
- Versioned export, backup, and restore services

Each subsystem exposes typed application interfaces so a future headless CLI can
reuse the core without importing React.

## Data flow

1. The browser submits validated user intent to a server endpoint.
2. The application service loads domain records through a repository.
3. Core logic resolves variables, authentication, or import behavior.
4. Sensitive operations run only on the server.
5. The service persists results and returns a redacted response DTO.
6. The UI renders the DTO and never receives stored secret values unless the
   user explicitly requests a reveal operation.
