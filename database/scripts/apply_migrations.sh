#!/usr/bin/env bash
# =============================================================================
# Offensive Conditions — Apply All Migrations
# =============================================================================
# Applies migrations for every schema in dependency order.
# Uses golang-migrate. Install: https://github.com/golang-migrate/migrate
# =============================================================================

set -euo pipefail

# Configuration
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-offcon}"
DB_USER="${DB_USER:-migrator}"
DB_PASS="${DB_PASS:-CHANGE_ME_VAULT_MANAGED}"
DB_SSLMODE="${DB_SSLMODE:-disable}"

# Compute DSN (URL-encoded password)
ENCODED_PASS=$(python3 -c "import urllib.parse; print(urllib.parse.quote('${DB_PASS}'))")
DSN="postgres://${DB_USER}:${ENCODED_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}?sslmode=${DB_SSLMODE}"

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
MIGRATIONS_ROOT="$( cd "${SCRIPT_DIR}/../migrations" && pwd )"

# Order matters: schemas with dependencies on others must come later.
# Even though there are no cross-schema FKs (by design), conceptual dependencies guide order.
SCHEMAS=(
    "auth"          # No dependencies
    "users"         # Logically depends on auth
    "content"       # Independent catalog
    "lab"           # Logically depends on users + content
    "scoring"       # Logically depends on users + content + lab
    "ctf"           # Depends on users + content
    "forum"         # Depends on users
    "writeup"       # Depends on users + content
    "payment"       # Depends on users
    "bounty"        # Depends on users
    "audit"         # Receives writes from all
)

# Check migrate is installed
if ! command -v migrate &> /dev/null; then
    echo "ERROR: 'migrate' CLI not found. Install golang-migrate:"
    echo "  brew install golang-migrate     # macOS"
    echo "  apt install golang-migrate      # Debian/Ubuntu (newer)"
    echo "  https://github.com/golang-migrate/migrate/releases   # binary"
    exit 1
fi

# Check connectivity
if ! psql "${DSN}" -c "SELECT 1" &> /dev/null; then
    echo "ERROR: Cannot connect to database at ${DB_HOST}:${DB_PORT}/${DB_NAME}"
    exit 1
fi

echo "==> Applying migrations to ${DB_HOST}:${DB_PORT}/${DB_NAME}"
echo ""

for SCHEMA in "${SCHEMAS[@]}"; do
    MIGRATION_DIR="${MIGRATIONS_ROOT}/${SCHEMA}"

    if [[ ! -d "${MIGRATION_DIR}" ]]; then
        echo "  ⊘  ${SCHEMA}: directory not found, skipping"
        continue
    fi

    # Count up migrations
    UP_COUNT=$(find "${MIGRATION_DIR}" -name "*.up.sql" | wc -l)
    if [[ "${UP_COUNT}" -eq 0 ]]; then
        echo "  ⊘  ${SCHEMA}: no migrations, skipping"
        continue
    fi

    echo "  →  ${SCHEMA}: applying ${UP_COUNT} migration(s)..."

    migrate \
        -path "${MIGRATION_DIR}" \
        -database "${DSN}&x-migrations-table=schema_migrations_${SCHEMA}" \
        -lock-timeout 60 \
        up 2>&1 | sed 's/^/      /'

    echo "  ✓  ${SCHEMA}: done"
    echo ""
done

echo "==> All migrations applied successfully"
echo ""
echo "Schema versions:"
psql "${DSN}" -t -A -F" | " <<-SQL
    SELECT
        replace(table_name, 'schema_migrations_', '') as schema,
        (SELECT version FROM information_schema.tables t2
         WHERE t2.table_name = t.table_name LIMIT 1) as table_exists
    FROM information_schema.tables t
    WHERE table_name LIKE 'schema_migrations_%'
    ORDER BY table_name;
SQL
