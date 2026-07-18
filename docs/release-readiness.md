# Release readiness

This review records the evidence used for the initial `v0.1.0` release. It is a
living checklist rather than a claim that a local-only application has no risk.

## Accessibility and keyboard review

- Interactive controls use native elements or Radix primitives with accessible
  names, focus management, Escape handling, and modal focus trapping.
- Global focus indicators use the active accent with a two-pixel offset.
- The command palette supports filtering, arrow-key selection, Enter, Escape,
  mouse selection, disabled actions, and focus restoration.
- Global shortcuts cover palette, search, create, save, send, and sidebar
  actions. The same actions remain available as labelled buttons.
- Playwright runs Axe against WCAG 2.0/2.1 A and AA rules on the project
  overview, request/response editor, variable editor, authentication editor,
  OpenAPI preview, workflow report, backup settings, and command palette.
- The review fixed the selected command description contrast; the release scan
  has no remaining violations in those surfaces.

Workbench remains desktop-first. The minimum supported layout is a laptop-sized
viewport; mobile optimisation is outside the initial release scope.

## Performance review

- Navigator search uses deferred input so filtering a large project tree does
  not block typing.
- Database lookups use committed indexes and bounded page/history queries.
- Request bodies, responses, imports, archives, expanded ZIP data, table row
  counts, execution history, and workflow history all have explicit limits.
- Imports and full restores batch inserts and use one transaction; automatic
  backup work runs outside browser requests and cannot overlap within a process.
- The production Next.js build completes without compiler or tracing warnings,
  and CI builds the production container for `linux/amd64` and `linux/arm64`.

Large real-world collections should still be profiled before raising the
documented limits. Virtualised project navigation is a future optimisation if
measured collections make it necessary.

## Security review

- Outbound HTTP execution restricts protocols, redirects, DNS results, cloud
  metadata addresses, private targets, timeouts, and response sizes.
- Secret taint and redaction cover previews, persisted execution data, logs,
  exports, authentication caches, variables, workflow overrides, and response
  metadata.
- Archive import rejects unknown paths, unsupported versions, invalid checksums
  or counts, oversized expansion, malformed relationships, and partial restore.
- Import parsers validate untrusted source documents before transactional writes.
- The production container runs as a non-root user. Backup files use owner-only
  permissions, and GHCR releases include an SBOM and build provenance.
- CI runs the npm high-severity audit. The release dependency graph has no known
  vulnerabilities at that threshold.

The remaining trust boundary is intentional: Workbench has no application login
and must run on a trusted local machine or private network. Operators must use
unique database credentials before exposing any service beyond localhost.

## Release gate

Every release candidate must pass formatting, lint, strict type checking, unit
coverage, component tests, migration validation, PostgreSQL integration tests,
Playwright plus Axe, a production build, a high-severity dependency audit, and
the two-platform container build. The tag must match `package.json`; the release
workflow then publishes versioned GHCR images and creates the GitHub release.
