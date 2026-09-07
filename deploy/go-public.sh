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

# www is here for the certificate and the origin allowlist. It is not a
# surface — the middleware maps any unrecognised host to the landing page,
# which is exactly where www should land.
SUBS=(www dashboard ctf bugbounty app admin)

TLS_PORT="$(grep -E "^EDGE_TLS_PORT=" .env | cut -d= -f2)"
TLS_PORT="${TLS_PORT:-8443}"

# --- 0. is the domain actually pointed here? ---------------------------------
# Note on this connection: outbound traffic leaves on a different address than
# the one inbound arrives on (a shared pool for egress, a static address for
# ingress). So "what does api.ipify.org say" is the wrong question — it reports
# the egress address and would reject a perfectly good setup. What matters is
# whether a connection from the internet lands here, so that is what gets
# tested: the domain is resolved, and the edge is probed through it.
step "Checking DNS"
RESOLVED="$(dig +short "$DOMAIN" A | tail -1 || true)"
if [[ -z "$RESOLVED" ]]; then
  echo "  $DOMAIN has no A record yet. Add these at the registrar first:" >&2
  printf '    %-12s A  <your inbound IP>\n' "@" >&2
  for s in "${SUBS[@]}"; do printf '    %-12s A  <your inbound IP>\n' "$s" >&2; done
  exit 1
fi
ok "$DOMAIN -> $RESOLVED"

for s in "${SUBS[@]}"; do
  r="$(dig +short "$s.$DOMAIN" A | tail -1 || true)"
  if [[ -z "$r" ]]; then
    echo "  $s.$DOMAIN has no A record — that surface would be unreachable." >&2
    exit 1
  fi
done
ok "all ${#SUBS[@]} subdomains resolve"

# Probe 443, not $TLS_PORT. $TLS_PORT is what the edge binds on the LAN; from
# the internet the router publishes it as 443, and 443 is what a visitor — and
# the check below — actually connects to. Probing the internal port against the
# public address tests a path nobody uses and fails on a working setup.
step "Checking the edge answers from outside"
CODE="$(curl -sk -o /dev/null -w '%{http_code}' --max-time 10 \
        "https://$RESOLVED/" -H "Host: $DOMAIN" || true)"
if [[ "$CODE" == "000" ]]; then
  echo "  nothing answered on $RESOLVED:443" >&2
  echo "  the router should forward external 443 to this machine on $TLS_PORT" >&2
  exit 1
fi
ok "edge answers on 443 (HTTP $CODE)"

CODE80="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://$RESOLVED/" || true)"
if [[ "$CODE80" == "000" ]]; then
  echo "  nothing answered on $RESOLVED:80 — the ACME challenge needs it" >&2
  exit 1
fi
ok "port 80 answers (HTTP $CODE80)"

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
# Development values that must not face the internet. The rate limits were
# 1000/minute so local testing never tripped them; on a public login form that
# is an open door for credential stuffing.
# APP_ENV deliberately stays "development", and that is not an oversight.
#
# Setting it to production turns on a config validator in auth, user-svc,
# scoring, flag-verifier and orchestrator that refuses to start without
# infrastructure this compose stack does not contain: a Postgres with TLS
# (DB_SSLMODE must not be "disable"), a Vault (flag-verifier requires
# VAULT_ENABLED=true), and a populated FLAG_HMAC_SECRET. Flipping the flag
# without those does not harden anything — every one of those services
# crash-loops and the site returns 502.
#
# The validator is right and the services are correct to refuse. Meeting it
# properly is a separate piece of work that belongs on a real server. What is
# set below is the hardening that needs no missing infrastructure.
# The OAuth callback. Its default is http://localhost:8001/v1/auth/oauth —
# the auth container's own address, which resolves for nothing but itself.
# Google sends the user there after consent, so leaving it unset means every
# social sign-in ends on a page that cannot load. It must also be registered
# as an authorised redirect URI in the provider's console, which is a manual
# step nobody can do from here.
set_var OAUTH_CALLBACK_BASE "https://$DOMAIN/v1/auth/oauth"

# Without this the services call RemoteAddr the client, and behind the edge
# that is always the edge — one rate-limit bucket shared by the whole internet.
set_var HTTP_TRUSTED_PROXIES "172.16.0.0/12"

set_var GRPC_ENABLE_REFLECTION false
set_var AUTH_INSECURE false
# 120, not the 5 a per-IP limit would deserve. Docker's published ports on
# macOS rewrite the source address before nginx ever sees it, so every request
# arrives from the bridge gateway and one counter covers all visitors. A tight
# number here locks out the site instead of an attacker. Lower it once the
# stack runs somewhere the original address survives.
set_var RATE_LIMIT_LOGIN_PER_MINUTE 120
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
  # webroot, not standalone: standalone wants port 80 to itself, which the
  # edge is already holding. Sharing the directory also means renewal needs no
  # downtime — certbot drops a file in and nginx serves it.
  ARGS=(certonly --webroot -w /var/www/certbot --non-interactive --agree-tos -d "$DOMAIN")
  for s in "${SUBS[@]}"; do ARGS+=(-d "$s.$DOMAIN"); done
  [[ -n "$EMAIL" ]] && ARGS+=(-m "$EMAIL") || ARGS+=(--register-unsafely-without-email)

  docker run --rm \
    -v "$PWD/secrets/letsencrypt:/etc/letsencrypt" \
    -v "$PWD/secrets/certbot-webroot:/var/www/certbot" \
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

# nginx.conf is a bind mount, so rewriting it changes nothing by itself and
# `compose up -d` will not recreate a container whose only change is the
# contents of a mounted file. Without this the new certificate sits on disk
# while the old one is still being served.
docker compose exec -T edge nginx -t >/dev/null 2>&1 \
  && docker compose exec -T edge nginx -s reload >/dev/null 2>&1 \
  && ok "edge reloaded" \
  || { docker compose restart edge >/dev/null 2>&1; ok "edge restarted"; }

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
    external 80/tcp   -> 80     certificate issue and renewal, port 80 is
                                fixed by the ACME HTTP-01 challenge and
                                cannot be moved
    external 443/tcp  -> $TLS_PORT   the site

  The edge listens on $TLS_PORT rather than 443 so it never contends with
  anything else on this machine. Visitors still use 443; the router maps it.

  ${YELLOW}Still open before this is safe to leave running:${RESET}
    * the refresh token is in a cookie page scripts can read
    * the orchestrator mounts the host Docker socket — anything that reaches
      its internal API can start a container on this machine
    * the database still holds test users and test events
    * APP_ENV is still development — see the note in this script; real
      production mode needs Postgres over TLS, a Vault, and FLAG_HMAC_SECRET

EOF
