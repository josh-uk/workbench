# ADR 0004: Request outputs power reuse

Status: Accepted

Reusable OAuth tokens are implemented as a specialization of general request
outputs. A named JSONPath extraction can feed later requests and workflows. This
avoids an authentication-only data path and supports IDs, CSRF tokens, cursors,
and other multi-step API workflows.
