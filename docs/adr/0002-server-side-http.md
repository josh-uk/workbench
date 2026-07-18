# ADR 0002: Server-side HTTP execution

Status: Accepted

HTTP requests execute in the server runtime. This avoids browser CORS limits and
keeps authentication material out of client code. It also makes the server a
potential network pivot, so protocol, address, redirect, payload, and timeout
controls are mandatory rather than optional hardening.
