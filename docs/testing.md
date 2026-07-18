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

CI runs formatting, linting, strict type checking, unit coverage, component
tests, migration checks, integration tests, a production build, Playwright,
container build, and a high-severity dependency audit. Failure artifacts include
coverage and Playwright traces or screenshots where relevant.
