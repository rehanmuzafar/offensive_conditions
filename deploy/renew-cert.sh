#!/usr/bin/env bash
#
# Renew the Let's Encrypt certificate and put the result where nginx reads it.
#
# Run twice a day from cron. certbot itself decides whether anything is due —
# it renews only inside the last 30 days, so running often is free and running
# rarely is how a site goes down on a Sunday.
#
# Three steps, and skipping any one of them silently breaks the site 90 days
# later:
#   1. renew — over the webroot the edge already serves, so no downtime
#   2. copy  — nginx reads /secrets/tls, not certbot's live directory
#   3. reload — nginx holds the old certificate in memory until told otherwise

set -euo pipefail
cd "$(dirname "$0")"

# The colima paths this used to hard-code only existed on one laptop, and the
# script silently did nothing anywhere else — including on the server that now
# owns the certificate. Set them only when that laptop's socket is actually
# present, so the same file works in both places.
if [ -S "$HOME/.colima/default/docker.sock" ]; then
  export PATH="/opt/homebrew/Cellar/docker/29.2.1/bin:$PATH"
  export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"
fi

DOMAIN="$(grep -E '^NEXT_PUBLIC_ROOT_DOMAIN=' .env | cut -d= -f2)"
[[ -n "$DOMAIN" ]] || { echo "no NEXT_PUBLIC_ROOT_DOMAIN in .env" >&2; exit 1; }

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

log "renewing $DOMAIN"
docker run --rm \
  -v "$PWD/secrets/letsencrypt:/etc/letsencrypt" \
  -v "$PWD/secrets/certbot-webroot:/var/www/certbot" \
  certbot/certbot renew --webroot -w /var/www/certbot --quiet

LIVE="secrets/letsencrypt/live/$DOMAIN"
[[ -f "$LIVE/fullchain.pem" ]] || { log "no certificate at $LIVE — nothing to install"; exit 0; }

# Only touch nginx when the certificate actually changed. cmp keeps a no-op run
# from reloading the edge twice a day for no reason.
if ! cmp -s "$LIVE/fullchain.pem" "secrets/tls/live-$DOMAIN.pem"; then
  cp "$LIVE/fullchain.pem" "secrets/tls/live-$DOMAIN.pem"
  cp "$LIVE/privkey.pem"   "secrets/tls/live-$DOMAIN-key.pem"
  chmod 600 "secrets/tls/live-$DOMAIN-key.pem"
  log "certificate updated, reloading edge"
  docker compose exec -T edge nginx -s reload
  log "done"
else
  log "certificate unchanged"
fi
