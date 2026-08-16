#!/usr/bin/env bash
# ============================================================================
#  OFFCON deploy setup — one-time prep before `docker compose up`.
#  Generates the shared JWT keypair that auth signs with and the other
#  services verify against.
# ============================================================================
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

mkdir -p secrets

if [[ -f secrets/jwt-private.pem && -f secrets/jwt-public.pem ]]; then
  echo "==> JWT keys already exist (secrets/jwt-private.pem). Skipping."
else
  echo "==> Generating RSA JWT keypair..."
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 \
    -out secrets/jwt-private.pem
  openssl rsa -in secrets/jwt-private.pem -pubout -out secrets/jwt-public.pem
  chmod 644 secrets/jwt-*.pem
  echo "==> Keys written to ./secrets/"
fi

cat <<'DONE'

==> Setup complete.

Next:
  docker compose up --build        # build + start the whole platform
  # or detached:
  docker compose up --build -d

Once up:
  Frontend   →  http://localhost:3000
  API edge   →  http://localhost:8080/v1/...
  Mailpit    →  http://localhost:8025   (catches auth emails)
  MinIO      →  http://localhost:9101   (offcon_dev / dev_only_change_in_prod)
  Adminer-ish: connect to postgres at localhost:5432 (offcon_admin / dev_only_change_in_prod)

First build is large (12 services + frontend) — give it time and a few GB RAM.
DONE
