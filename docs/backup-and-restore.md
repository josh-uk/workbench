# Backup and restore design

Exports use a versioned manifest and exclude secrets by default. Workspace and
project exports are ZIP archives containing logical JSON documents grouped by
resource type. Import validates the manifest version and every archive path
before opening a transaction.

Secret export modes are:

1. Exclude secrets (default)
2. Include secrets encrypted with a user-supplied password
3. Include plain-text secrets after a prominent confirmation

Full backups include application data and schema version metadata. Restore runs
compatibility checks, records an audit summary, and either completes atomically
or leaves the original data unchanged. Automatic backups use timestamped names,
configurable retention, and a dedicated mounted directory.

Until Phase 9 ships these workflows, use a PostgreSQL-native logical backup from
a stopped or transactionally consistent database. Raw copies of a live database
volume are not a supported backup.
