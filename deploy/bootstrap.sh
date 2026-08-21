#!/usr/bin/env bash
#
# Creates everything a clone needs to run that is deliberately not in git:
# deploy/.env and the JWT signing keypair.
#
# Those two are excluded because they hold secrets, which is correct — but it
# left a fresh clone unable to start, with the failure showing up as a compose
# variable error that says nothing about what to do. This closes that gap
# without putting a single secret in the repository: every value is generated
# locally, on the machine that will use it.
#
# Idempotent. Running it again fills in anything missing and touches nothing
# that already has a value, so it is safe after every `git pull` — which is the
# point, since a pull can introduce a new required variable.

set -euo pipefail

cd "$(dirname "$0")"

ENV_FILE=".env"
EXAMPLE=".env.example"
SECRETS_DIR="secrets"

info() { printf '  %s\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }

# openssl rather than reading /dev/urandom through `head`: closing that pipe
# sends SIGPIPE to `tr`, which under `set -o pipefail` fails the whole script.
# base64 is filtered down to alphanumerics so a generated value can never
# contain a character that a .env parser, a URL or a shell would treat as
# syntax.
rand() {
  local n="${1:-32}"
  LC_ALL=C openssl rand -base64 $(( n * 2 )) | tr -cd 'A-Za-z0-9' | cut -c1-"$n"
}
rand_hex() { openssl rand -hex "${1:-32}"; }

# -----------------------------------------------------------------------------
# 1. deploy/.env
# -----------------------------------------------------------------------------
echo "==> Environment"

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$EXAMPLE" "$ENV_FILE"
  ok "created $ENV_FILE from $EXAMPLE"
else
  info "$ENV_FILE exists — filling in anything missing"
fi

# Append variables the example has gained since this .env was written. A pull
# that adds a required variable would otherwise stop the stack with a compose
# error naming a variable the operator has never heard of.
added=0
while IFS= read -r line; do
  [[ "$line" =~ ^([A-Z_][A-Z0-9_]*)= ]] || continue
  key="${BASH_REMATCH[1]}"
  grep -qE "^${key}=" "$ENV_FILE" || { printf '%s\n' "$line" >> "$ENV_FILE"; added=$((added + 1)); }
done < "$EXAMPLE"
if [[ $added -gt 0 ]]; then ok "added $added new variable(s) from $EXAMPLE"; fi

# Fill a variable only when it is empty or still carries a placeholder. Existing
# values are never touched: regenerating a database password against a database
# that already exists would lock the stack out of its own data.
set_secret() {
  local key="$1" value="$2"
  local current
  current="$(grep -E "^${key}=" "$ENV_FILE" | head -1 | cut -d= -f2- || true)"
  case "$current" in
    ""|change-me|changeme|CHANGEME|replace-me|xxx|TODO) ;;
    *) return 0 ;;
  esac
  # A literal & or | in a generated value would be reinterpreted by sed, so the
  # rewrite is done in awk with the value passed as data rather than as pattern.
  awk -v k="$key" -v v="$value" '
    BEGIN { FS = OFS = "=" }
    $1 == k { print k "=" v; next }
    { print }
  ' "$ENV_FILE" > "$ENV_FILE.tmp" && mv "$ENV_FILE.tmp" "$ENV_FILE"
  ok "generated $key"
}

# Postgres and its application role share one password here; compose passes the
# same value to both, and a mismatch is the single most common way to end up
# with a database nothing can log into.
PG_PASS="$(rand 24)"
set_secret POSTGRES_PASSWORD "$PG_PASS"
set_secret DB_PASSWORD "$(grep -E '^POSTGRES_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)"

set_secret REDIS_PASSWORD "$(rand 24)"

# Object storage is one account under four names. MinIO's root credentials are
# what the services authenticate with, and user-svc calls them STORAGE_* while
# bounty-svc calls them S3_* — so all four are set from the same pair. Generating
# them independently produces a stack where uploads fail with an opaque 403.
set_secret MINIO_ROOT_USER "offcon"
set_secret MINIO_ROOT_PASSWORD "$(rand 32)"
MINIO_USER="$(grep -E '^MINIO_ROOT_USER=' "$ENV_FILE" | cut -d= -f2-)"
MINIO_PASS="$(grep -E '^MINIO_ROOT_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)"
set_secret STORAGE_ACCESS_KEY "$MINIO_USER"
set_secret STORAGE_SECRET_KEY "$MINIO_PASS"
set_secret S3_ACCESS_KEY "$MINIO_USER"
set_secret S3_SECRET_KEY "$MINIO_PASS"

# 32 bytes, hex — the TOTP secrets in the database are encrypted with this.
# Losing or changing it makes every enrolled second factor undecryptable.
set_secret TFA_ENCRYPTION_KEY "$(rand_hex 32)"

set_secret OAUTH_STATE_SECRET "$(rand 32)"
set_secret ORCHESTRATOR_INTERNAL_TOKEN "$(rand 32)"

# Anything else that is obviously a secret and is still empty.
#
# Without this, a teammate who adds a new required secret and pushes it leaves
# every other clone unable to start: the variable arrives in .env.example, gets
# appended empty, and compose refuses on a name nobody recognises. Matching on
# the name means their change works everywhere on the next pull without anyone
# editing this script.
#
# EXTERNAL is the exception list: credentials issued by somebody else. A
# generated value there would be worse than an empty one — the feature would
# appear configured and then fail against the real provider. Empty leaves it
# switched off, which is the honest state.
EXTERNAL='^(STRIPE_|SMTP_|OAUTH_GOOGLE_|OAUTH_GITHUB_|SENTRY_|TWILIO_|AWS_)'

while IFS= read -r line; do
  [[ "$line" =~ ^([A-Z_][A-Z0-9_]*)=(.*)$ ]] || continue
  key="${BASH_REMATCH[1]}"
  [[ "$key" =~ (SECRET|PASSWORD|TOKEN|_KEY|SALT)$ ]] || continue
  [[ "$key" =~ $EXTERNAL ]] && continue
  # Path variables merely point at a file; generating one would be nonsense.
  [[ "$key" =~ (_PATH|_URL|_ADDR)$ ]] && continue
  # Already handled above as a matched set.
  [[ "$key" =~ ^(STORAGE_|S3_|MINIO_) ]] && continue
  current="$(grep -E "^${key}=" "$ENV_FILE" | head -1 | cut -d= -f2- || true)"
  if [[ -z "$current" ]]; then
    set_secret "$key" "$(rand 32)"
  fi
done < "$ENV_FILE"

# -----------------------------------------------------------------------------
# 2. Docker socket group
# -----------------------------------------------------------------------------
# The orchestrator runs as a non-root user and needs the group that owns the
# mounted socket. The gid differs per host and — on Docker Desktop and colima —
# differs between what the host sees and what a container sees. Asking a
# throwaway container is the only reading that matches what the orchestrator
# will actually get.
current_gid="$(grep -E '^DOCKER_SOCKET_GID=' "$ENV_FILE" | cut -d= -f2- || true)"
if [[ -z "$current_gid" || "$current_gid" == "991" ]]; then
  if detected="$(docker run --rm -v /var/run/docker.sock:/var/run/docker.sock alpine \
                   stat -c %g /var/run/docker.sock 2>/dev/null)" && [[ -n "$detected" ]]; then
    awk -v v="$detected" '
      BEGIN { FS = OFS = "=" }
      $1 == "DOCKER_SOCKET_GID" { print "DOCKER_SOCKET_GID=" v; next }
      { print }
    ' "$ENV_FILE" > "$ENV_FILE.tmp" && mv "$ENV_FILE.tmp" "$ENV_FILE"
    ok "detected DOCKER_SOCKET_GID=$detected"
  else
    warn "could not detect the docker socket group — spawning lab containers may fail"
  fi
fi

# -----------------------------------------------------------------------------
# 3. JWT signing keypair
# -----------------------------------------------------------------------------
echo "==> Signing keys"
mkdir -p "$SECRETS_DIR"
if [[ -f "$SECRETS_DIR/jwt-private.pem" ]]; then
  info "keypair already present — keeping it"
else
  # RSA-2048: what the services are configured to verify with. Regenerating it
  # invalidates every issued token, which is why it is never overwritten.
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 \
    -out "$SECRETS_DIR/jwt-private.pem" 2>/dev/null
  openssl rsa -in "$SECRETS_DIR/jwt-private.pem" -pubout \
    -out "$SECRETS_DIR/jwt-public.pem" 2>/dev/null
  chmod 600 "$SECRETS_DIR/jwt-private.pem"
  ok "generated RSA-2048 keypair in $SECRETS_DIR/"
fi

# -----------------------------------------------------------------------------
# 4. What is still the operator's job
# -----------------------------------------------------------------------------
echo "==> Optional integrations"
for var in STRIPE_SECRET_KEY SMTP_PASSWORD OAUTH_GOOGLE_CLIENT_SECRET; do
  value="$(grep -E "^${var}=" "$ENV_FILE" | head -1 | cut -d= -f2- || true)"
  if [[ -z "$value" ]]; then info "$var is empty — the feature behind it stays off"; fi
done

echo
ok "Ready. Next: ./setup.sh (or docker compose up -d from deploy/)"
