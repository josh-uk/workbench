# ADR 0001: PostgreSQL persistence

Status: Accepted

Workbench uses PostgreSQL instead of SQLite. The product requires structured
relationships, migrations, transactional imports and restores, JSON metadata,
and production-like integration testing. Compose makes the additional local
service predictable, and a named volume preserves data across restarts. The cost
is more operational weight than a single database file.
