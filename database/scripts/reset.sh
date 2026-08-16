#!/usr/bin/env bash
# =============================================================================
# DEV ONLY — Drop and recreate the entire offcon database
# =============================================================================
# DO NOT RUN IN PRODUCTION. EVER.
# =============================================================================

set -euo pipefail

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_ADMIN_USER="${DB_ADMIN_USER:-offcon_admin}"
DB_ADMIN_PASS="${DB_ADMIN_PASS:-dev_only_change_in_prod}"
DB_NAME="${DB_NAME:-offcon}"

# Safety: refuse to run if DB host is anything other than localhost
if [[ "${DB_HOST}" != "localhost" && "${DB_HOST}" != "127.0.0.1" && "${DB_HOST}" != "postgres" ]]; then
    echo "REFUSING: reset.sh blocked for non-local host '${DB_HOST}'"
    exit 1
fi

# Safety: explicit confirmation
read -p "This will DESTROY all data in '${DB_NAME}'. Type 'yes' to continue: " CONFIRM
if [[ "${CONFIRM}" != "yes" ]]; then
    echo "Aborted."
    exit 0
fi

export PGPASSWORD="${DB_ADMIN_PASS}"

echo "==> Terminating all connections to ${DB_NAME}..."
psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_ADMIN_USER}" -d postgres <<-SQL
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid();
SQL

echo "==> Dropping database ${DB_NAME}..."
dropdb -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_ADMIN_USER}" --if-exists "${DB_NAME}"

echo "==> Creating database ${DB_NAME}..."
createdb -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_ADMIN_USER}" \
    --owner="${DB_ADMIN_USER}" \
    --encoding=UTF8 \
    --locale=C.UTF-8 \
    --template=template0 \
    "${DB_NAME}"

echo "==> Running init.sql..."
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_ADMIN_USER}" -d "${DB_NAME}" -f "${SCRIPT_DIR}/init.sql"

echo "==> Done. Now run apply_migrations.sh"
