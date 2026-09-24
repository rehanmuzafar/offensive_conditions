#!/usr/bin/env bash
#
# The only command needed after a clone, and after every pull.
#
#   git clone … && ./setup.sh     first run
#   git pull    && ./setup.sh     every time after
#
# It is one script rather than a list of steps in a README because the steps
# have an order that is not obvious and a mistake in it produces confusing
# failures — a stale image serving old code, or migrations run against a
# database that is not up yet.
#
# Idempotent throughout: nothing is regenerated, no data is dropped, and running
# it on an unchanged tree just rebuilds and restarts.

set -euo pipefail
cd "$(dirname "$0")"

BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; RESET=$'\033[0m'
step() { printf '\n%s==> %s%s\n' "$BOLD" "$*" "$RESET"; }
ok()   { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$*"; }

command -v docker >/dev/null || { echo "docker is not installed"; exit 1; }
docker info >/dev/null 2>&1 || { echo "the docker daemon is not running"; exit 1; }

# --- 1. secrets and environment ----------------------------------------------
step "Secrets and environment"
./deploy/bootstrap.sh

cd deploy

# --- 2. images ----------------------------------------------------------------
# Through compose, never a bare `docker build`. The frontend takes
# NEXT_PUBLIC_API_BASE_URL as a *build* argument — Next inlines it at build time,
# including into the /api rewrite — so an image built without it silently points
# the browser at the production API and every request fails.
step "Building images"
docker compose build
ok "images built"

# --- 3. infrastructure --------------------------------------------------------
# Postgres and Redis first and on their own: the migrator connects on startup,
# and starting everything at once means it races the database it is migrating.
step "Starting datastores"
docker compose up -d postgres redis
until docker compose exec -T postgres pg_isready -q 2>/dev/null; do sleep 1; done
ok "postgres accepting connections"

# --- 4. schema ----------------------------------------------------------------
# Runs every migration that has not been applied yet, per schema. This is the
# step that makes `git pull` sufficient: a colleague's new migration arrives with
# the code and is applied here, against your data.
step "Applying migrations"
docker compose run --rm migrator
ok "schema up to date"

# --- 5. everything else -------------------------------------------------------
step "Starting services"
docker compose up -d
ok "services started"

step "Status"
docker compose ps --format 'table {{.Service}}\t{{.Status}}'

cat <<EOF

  ${GREEN}Ready.${RESET}

  Frontend   http://localhost:3000
  API edge   http://localhost:8080
  Mail       http://localhost:8025   ${DIM}(every outgoing email lands here)${RESET}

  ${DIM}Logs:     docker compose -f deploy/docker-compose.yml logs -f <service>
  Stop:     docker compose -f deploy/docker-compose.yml down
  Reset DB: docker compose -f deploy/docker-compose.yml down -v${RESET}

EOF
