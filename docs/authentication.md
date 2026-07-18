# Authentication design

Authentication profiles live at workspace or project scope. Project overrides
may replace selected fields without copying the parent profile. Supported profile
types are none, bearer, basic, API key, OAuth 2.0 client credentials, password,
refresh token, and request-derived authentication.

Secret fields are masked by default and must never enter ordinary logs. The
browser receives redacted profile DTOs; reveal and update operations are explicit
server calls.

Request-derived authentication is built on general request outputs. A token
profile can identify a saved token request, JSONPath expressions for token and
expiry fields, its injection target, and refresh behavior. Before a dependent
request runs, the server checks a cached output, refreshes it when necessary,
injects the result, and returns a redacted execution trace.

This design lets the same output mechanism pass entity IDs, CSRF tokens,
pagination cursors, and other workflow values without embedding OAuth-specific
logic in the request model.
