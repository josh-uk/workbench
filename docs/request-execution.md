# Request execution

Outbound requests run in the Next.js server's Node.js runtime, not in the
browser. The execution service receives a typed request plan after variable and
authentication resolution and returns redacted response metadata.

The engine allows only HTTP and HTTPS. It resolves and validates every target,
including redirects, blocks cloud metadata destinations, applies timeouts and
request/response size limits, rejects header injection, and supports
cancellation. Proxy and TLS overrides are explicit settings with visible risk
warnings.

History stores method, a safely displayable resolved URL, timestamps, status,
duration, size, headers, cookies, redirect chain, bounded body previews, and
structured errors. Authorization, tokens, passwords, cookies, secret variables,
and other configured secret fields are redacted before logging or persistence.
