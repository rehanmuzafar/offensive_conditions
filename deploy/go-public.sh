#!/usr/bin/env bash
#
# Point the stack at a real domain and serve it to the internet.
#
#   ./deploy/go-public.sh offensiveconditions.org
#
# Run this once the domain's DNS resolves to this machine's public IP. Before
# that it cannot work, and not because of caution — three things break:
#
#   * The certificate. The local one is issued by your own mkcert CA, which no
#     visitor trusts, and it does not list your IP. Every browser blocks it.
#   * The surfaces. Which product a request gets is decided from the hostname
#     (ctf.…, app.…, bugbounty.…). An IP address matches none of them, so a
#     visitor gets the landing page and /ctf redirects back to /.
#   * Sign-in. Every service checks Origin against an allowlist. An origin that
#     is not in it gets a 403 with an empty body, which the frontend can only
#     report as a generic failure.
#
# This fixes all three, and switches the development defaults that should not
# face the internet.

set -euo pipefail
cd "$(dirname "$0")"

DOMAIN="${1:-}"
EMAIL="${2:-}"
if [[ -z "$DOMAIN" ]]; then
  echo "usage: $0 <domain> [email-for-letsencrypt]" >&2
  exit 1
fi

BOLD=$'\033[1m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'
step() { printf '\n%s==> %s%s\n' "$BOLD" "$*" "$RESET"; }
ok()   { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '  %s!%s %s\n' "$YELLOW" "$RESET" "$*"; }

SUBS=(dashboard ctf bugbounty app admin)

# --- 0. is the domain actually pointed here? ---------------------------------
step "Checking DNS"
PUBLIC_IP="$(curl -s --max-time 10 https://api.ipify.org || true)"
RESOLVED="$(dig +short "$DOMAIN" | tail -1 || true)"
if [[ -z "$RESOLVED" ]]; then
  echo "  $DOMAIN does not resolve yet. Add the A records first:" >&2
  printf '    %-28s A  %s\n' "@" "$PUBLIC_IP" >&2
  for s in "${SUBS[@]}"; do printf '    %-28s A  %s\n' "$s" "$PUBLIC_IP" >&2; done
  exit 1
fi
if [[ "$RESOLVED" != "$PUBLIC_IP" ]]; then
  warn "$DOMAIN resolves to $RESOLVED but this machine is $PUBLIC_IP"
  warn "carry on only if that is deliberate (a proxy in front, for example)"
fi
ok "$DOMAIN -> $RESOLVED"

# --- 1. environment ----------------------------------------------------------
step "Environment"
cp .env ".env.bak-$(date +%s)"
ok "backed up .env"

ORIGINS="https://$DOMAIN"
for s in "${SUBS[@]}"; do ORIGINS+=" https://$s.$DOMAIN"; done

set_var() {
  local key="$1" value="$2"
  if grep -qE "^${key}=" .env; then
    awk -v k="$key" -v v="$value" 'BEGIN{FS=OFS="="} $1==k{print k "=" v; next} {print}' \
      .env > .env.tmp && mv .env.tmp .env
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}

set_var NEXT_PUBLIC_ROOT_DOMAIN "$DOMAIN"
set_var HTTP_CORS_ORIGINS "$ORIGINS"
set_var EDGE_TLS_PORT 443
# Development values that must not face the internet. The rate limits were
# 1000/minute so local testing never tripped them; on a public login form that
# is an open door for credential stuffing.
set_var APP_ENV production
set_var DEPLOY_ENV production
set_var RATE_LIMIT_LOGIN_PER_MINUTE 5
set_var RATE_LIMIT_REGISTER_PER_HOUR 5
set_var RATE_LIMIT_PASSWORD_RESET_PER_HOUR 3
set_var RATE_LIMIT_EMAIL_VERIFY_PER_HOUR 10
ok "environment switched to production values"

# --- 2. certificate ----------------------------------------------------------
step "TLS certificate"
if [[ -f "secrets/tls/live-$DOMAIN.pem" ]]; then
  ok "certificate already present"
else
  # HTTP-01 over port 80, which the router must forward. A wildcard would need
  # DNS-01 and an API token for the registrar; naming each host keeps this to
  # one step, and there are six of them.
  ARGS=(certonly --standalone --non-interactive --agree-tos -d "$DOMAIN")
  for s in "${SUBS[@]}"; do ARGS+=(-d "$s.$DOMAIN"); done
  [[ -n "$EMAIL" ]] && ARGS+=(-m "$EMAIL") || ARGS+=(--register-unsafely-without-email)

  docker run --rm -p 80:80 \
    -v "$PWD/secrets/letsencrypt:/etc/letsencrypt" \
    certbot/certbot "${ARGS[@]}"

  cp "secrets/letsencrypt/live/$DOMAIN/fullchain.pem" "secrets/tls/live-$DOMAIN.pem"
  cp "secrets/letsencrypt/live/$DOMAIN/privkey.pem"  "secrets/tls/live-$DOMAIN-key.pem"
  chmod 600 "secrets/tls/live-$DOMAIN-key.pem"
  ok "certificate issued for $DOMAIN and ${#SUBS[@]} subdomains"
fi

# --- 3. edge -----------------------------------------------------------------
step "Edge"
python3 - "$DOMAIN" <<'PY'
import pathlib, re, sys
domain = sys.argv[1]
p = pathlib.Path("nginx.conf"); s = p.read_text()
s = re.sub(r'server_name lvh\.me \*\.lvh\.me localhost;',
           f'server_name {domain} *.{domain} lvh.me *.lvh.me localhost;', s)
s = re.sub(r'ssl_certificate\s+/secrets/tls/lvh\.pem;',
           f'ssl_certificate     /secrets/tls/live-{domain}.pem;', s)
s = re.sub(r'ssl_certificate_key /secrets/tls/lvh-key\.pem;',
           f'ssl_certificate_key /secrets/tls/live-{domain}-key.pem;', s)
p.write_text(s)
PY
ok "edge serves $DOMAIN"

# --- 4. rebuild and restart --------------------------------------------------
# The root domain is inlined by Next at build time, so the frontend has to be
# rebuilt — restarting it with a new variable changes nothing.
step "Rebuilding the frontend for $DOMAIN"
docker compose build frontend
docker compose up -d
ok "running"

cat <<EOF

  ${GREEN}Live at https://$DOMAIN${RESET}

  Forward these on the router to this machine:
    80/tcp   -> needed for certificate renewal
    443/tcp  -> the site

  ${YELLOW}Still open before this is safe to leave running:${RESET}
    * the refresh token is in a cookie page scripts can read
    * the orchestrator mounts the host Docker socket — anything that reaches
      its internal API can start a container on this machine
    * the database still holds test users and test events

EOF
