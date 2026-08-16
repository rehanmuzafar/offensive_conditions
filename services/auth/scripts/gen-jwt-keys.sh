#!/usr/bin/env bash
# =============================================================================
# Generate RSA keypair for JWT signing.
# DEV/LOCAL USE ONLY. Production keys come from Vault / HSM.
# =============================================================================
set -euo pipefail

SECRETS_DIR="${SECRETS_DIR:-./secrets}"
PRIV_PATH="${SECRETS_DIR}/jwt-private.pem"
PUB_PATH="${SECRETS_DIR}/jwt-public.pem"

if [ -f "$PRIV_PATH" ] && [ -z "${FORCE:-}" ]; then
    echo "Keys already exist at $SECRETS_DIR. Set FORCE=1 to overwrite."
    exit 0
fi

mkdir -p "$SECRETS_DIR"

echo "Generating RSA 2048-bit keypair..."

# Private key
openssl genpkey -algorithm RSA -out "$PRIV_PATH" -pkeyopt rsa_keygen_bits:2048
chmod 0600 "$PRIV_PATH"

# Public key
openssl rsa -in "$PRIV_PATH" -pubout -out "$PUB_PATH"
chmod 0644 "$PUB_PATH"

echo "✓ Wrote $PRIV_PATH"
echo "✓ Wrote $PUB_PATH"
echo ""
echo "Add to your .env:"
echo "  JWT_PRIVATE_KEY_PATH=$(pwd)/$PRIV_PATH"
echo "  JWT_PUBLIC_KEY_PATH=$(pwd)/$PUB_PATH"
