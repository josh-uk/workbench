# ADR 0008: Layered test tools

Status: Accepted

Vitest runs unit and integration tests, React Testing Library verifies component
behavior through accessible interactions, and Playwright covers real browser
flows. PostgreSQL services and local mock APIs keep tests deterministic and
independent of public internet services.
