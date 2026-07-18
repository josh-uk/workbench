# ADR 0004: Request outputs power reuse

Status: Accepted

Reusable OAuth tokens are implemented as a specialization of general request
outputs. A named JSONPath extraction can feed later requests and workflows. This
avoids an authentication-only data path and supports IDs, CSRF tokens, cursors,
and other multi-step API workflows.

Output definitions belong to saved requests; extracted values belong to one
execution and may have an expiry. The latest unexpired value is exposed as a
generated project variable. Direct OAuth grants use a separate per-profile cache
because their token endpoint is profile configuration rather than a saved
request. Both paths share expiry, refresh, redaction, and injection semantics.
