# Request execution

Outbound requests run in the Next.js server's Node.js runtime, not in the
browser. The execution service receives a typed request plan after variable and
authentication resolution and returns redacted response metadata.

The engine allows only HTTP and HTTPS. It resolves all DNS results, validates
them, then connects to a validated address rather than resolving the hostname a
second time during the socket connection. Every redirect repeats this process.
Cloud metadata destinations are always blocked. Private, loopback, link-local,
carrier-grade NAT, reserved, and multicast addresses are blocked by default;
one request can visibly opt into a trusted private/local API without bypassing
the metadata block.

Per-request settings control a 100–120,000 ms timeout, up to ten redirects, TLS
certificate verification, and a 1 KiB–10 MiB response limit. Defaults are 30
seconds, five redirects, TLS verification enabled, private-network access
disabled, and a 1 MiB response limit. Request bodies are capped at 2 MiB.
Workbench owns hop-by-hop and framing headers, rejects invalid names and CR/LF
values, and supports cancellation through an in-process execution registry.

The request model supports JSON, text, XML, URL-encoded forms, multipart data,
and binary content in addition to requests without a body. Binary file selection
stores bounded base64 content in PostgreSQL. Proxy support is intentionally not
implemented yet because a partially constrained proxy path would undermine the
same outbound policy.

History stores method, a safely displayable resolved URL, timestamps, status,
duration, size, headers, cookies, redirect chain, bounded body previews, and
structured errors. Authorization, tokens, passwords, cookies, sensitive query
values, marked secret headers, and configured secret fields are redacted from
request snapshots and matching textual response content before persistence.
History is capped at the latest 100 executions per project. Body previews are
capped at 1 MiB even when a larger response limit is selected. Image bodies are
stored as bounded base64 previews; untrusted HTML renders only in an iframe with
an empty sandbox permission set.
