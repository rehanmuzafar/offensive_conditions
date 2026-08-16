# Offensive Conditions — Database Layer

PostgreSQL 16 schemas, migrations, and seed data for the entire platform.

## Architecture

We use **schema-per-service** pattern. Each microservice owns its schema(s) and no cross-service joins are allowed. Services communicate via APIs or events.

## Database Layout

```
postgres (cluster)
└── offcon (database)
    ├── auth          — authentication, sessions, tokens
    ├── users         — profiles, teams, subscriptions
    ├── content       — machines, challenges, paths, dojos
    ├── lab           — instance lifecycle, compute nodes
    ├── scoring       — submissions, points, achievements
    ├── ctf           — events, challenges, scoreboards
    ├── forum         — threads, posts, votes
    ├── writeup       — submitted solutions
    ├── payment       — subscriptions, invoices, transactions
    ├── bounty        — programs, reports (Phase 5)
    └── audit         — security audit log
```

## Migration Strategy

- **Tool:** `golang-migrate` (compatible with all services)
- **Format:** `NNNN_description.up.sql` + `NNNN_description.down.sql`
- **Numbering:** 4-digit sequential per schema (`0001_`, `0002_`, ...)
- **Naming:** snake_case, descriptive verbs (`add_users_table`, `add_email_index`)
- **Atomicity:** Every migration must be reversible
- **Idempotency:** Use `IF NOT EXISTS` where possible

## Conventions

### Naming
- Tables: `snake_case`, plural (`users`, `lab_instances`)
- Columns: `snake_case`, singular (`user_id`, `created_at`)
- Indexes: `idx_<table>_<columns>` (`idx_users_email`)
- Constraints: `<type>_<table>_<columns>` (`fk_instances_user_id`, `chk_users_status`)
- Sequences: `seq_<table>_<column>`

### Standard Columns
Every table should have:
```sql
id          UUID PRIMARY KEY DEFAULT gen_random_uuid()
created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

For soft-deletable tables:
```sql
deleted_at  TIMESTAMPTZ
```

### Data Types
- IDs: `UUID` (never sequential integers for public-facing entities)
- Strings: `TEXT` unless length matters (`VARCHAR(n)` for length-limited)
- Emails: `CITEXT` (case-insensitive)
- Timestamps: `TIMESTAMPTZ` (always with timezone)
- IPs: `INET`, networks: `CIDR`
- Money: `NUMERIC(12,2)` (never `FLOAT`)
- JSON: `JSONB` (never `JSON`)
- Enums: `TEXT` with `CHECK` constraint (more flexible than native enums)

### Indexing Rules
- Index foreign keys (PostgreSQL doesn't auto-index FKs)
- Index columns used in `WHERE`, `ORDER BY`, `JOIN`
- Partial indexes for filtered queries (`WHERE status = 'active'`)
- Composite indexes follow query patterns (leftmost-prefix)
- Avoid over-indexing (slows writes)

### Performance
- Use `UUID v7` (time-ordered) for high-volume tables (better B-tree locality)
- Partition large tables by time (audit log, submissions)
- Use `pg_partman` for automatic partition management

## File Organization

```
database/
├── README.md                       # This file
├── docker-compose.yml              # Local dev Postgres + extensions
├── migrations/
│   ├── auth/
│   │   ├── 0001_init.up.sql
│   │   ├── 0001_init.down.sql
│   │   ├── 0002_add_oauth.up.sql
│   │   └── ...
│   ├── users/
│   ├── content/
│   ├── lab/
│   ├── scoring/
│   ├── ctf/
│   ├── forum/
│   ├── writeup/
│   ├── payment/
│   ├── bounty/
│   └── audit/
│
├── seeds/                          # Development seed data
│   ├── 01_test_users.sql
│   ├── 02_sample_machines.sql
│   ├── 03_sample_challenges.sql
│   └── 04_sample_paths.sql
│
└── scripts/
    ├── init.sql                    # Cluster initialization
    ├── create_database.sh
    ├── apply_migrations.sh
    ├── reset.sh                    # Dev only
    └── backup.sh
```

## Quick Start (Local Development)

```bash
# Start Postgres
docker-compose up -d postgres

# Apply all migrations
./scripts/apply_migrations.sh

# Load seed data
psql -U offcon -d offcon -f seeds/01_test_users.sql

# Connect
psql -U offcon -d offcon
```

## Security Notes

- Each service connects with **its own DB user** (least privilege)
- Service users have access only to their schema
- Read-only replicas for reporting/analytics
- All connections use TLS (`sslmode=verify-full` in prod)
- Passwords managed via HashiCorp Vault
- No direct production DB access except via bastion + audit log
