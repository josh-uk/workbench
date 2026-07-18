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

Secret values participate in resolution normally but are redacted from previews,
logs, traces, fixtures, and screenshots. Cycles and recursive interpolation depth
must be detected and reported deterministically.
