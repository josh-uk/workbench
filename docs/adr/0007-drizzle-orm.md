# ADR 0007: Drizzle ORM

Status: Accepted

Workbench uses Drizzle ORM for strongly typed SQL-oriented schemas and explicit
generated migrations. It keeps relational details visible and adds less runtime
abstraction than a heavier data mapper. Repository modules remain responsible
for domain boundaries and transactions.
