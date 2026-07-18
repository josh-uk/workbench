# Variable resolution

Variables use the following precedence, from most specific to broadest:

1. Temporary runtime override
2. Request variable
3. Generated runtime output
4. Project environment variable
5. Project variable
6. Workspace environment variable
7. Workspace variable

Interpolation uses `{{name}}`. Resolution returns both the final value and its
origin so the UI can explain overrides. A preview operation reports unresolved
names before execution.

Workspace and project scopes each have base variables and any number of named
environments. A saved request selects at most one workspace environment and one
project environment, then adds request variables. Temporary runtime overrides
are sent only with the next preview or execution and are never written to the
database. Generated runtime output occupies its documented precedence slot and
is populated by the request-output engine in Phase 5.

Names are case-sensitive during interpolation and use letters, numbers, dots,
dashes, and underscores. A name must start with a letter or underscore. Names
must be unique, ignoring case, within one scope. Values may reference other
variables recursively; cycles and chains deeper than 20 levels return
deterministic errors. An unresolved placeholder remains visible in the preview
and prevents network execution. That failure is retained in request history.

Secret values participate in resolution normally but are masked by default in
editors and resolution previews. Secret taint propagates through nested values:
if `authorization` contains `Bearer {{token}}` and `token` is secret, the full
resolved `authorization` value is secret too. Actual values exist only in the
server-side execution plan. Execution snapshots, resolved display URLs,
response headers, and matching textual response content are redacted before
persistence. Tests and documentation use generic fake values and never include
real credentials.

![Scoped variables and environments](images/phase-10-variables.png)

Environment deletion removes stale selections from saved request settings.
Duplicating an environment copies its variables; duplicating a project or
workspace deep-copies all applicable variable scopes and remaps selected
environment IDs.
