# ADR 0005: Local-only trust model

Status: Accepted

Workbench does not provide application accounts. It assumes the local host and
browser session are trusted and documents that it should not be exposed to
untrusted networks. Data, import, browser-rendering, secret, and outbound-request
controls still apply because local API data and networks remain sensitive.
