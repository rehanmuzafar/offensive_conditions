#!/usr/bin/env bash
# =============================================================================
# Setup K8s RBAC and Secrets for the orchestrator
# =============================================================================
# Run after deploying database / auth service. Idempotent — safe to re-run.
# Requires: kubectl, openssl
# =============================================================================
set -euo pipefail

NAMESPACE="${NAMESPACE:-offcon-orchestrator}"
AUTH_PUBLIC_KEY_PATH="${AUTH_PUBLIC_KEY_PATH:-../auth/secrets/jwt-public.pem}"
DRY_RUN="${DRY_RUN:-false}"

apply() {
  if [[ "$DRY_RUN" == "true" ]]; then
    cat
  else
    kubectl apply -f -
  fi
}

echo "▶ Creating namespaces..."
cat <<EOF | apply
apiVersion: v1
kind: Namespace
metadata:
  name: ${NAMESPACE}
---
apiVersion: v1
kind: Namespace
metadata:
  name: lab-instances
  labels:
    name: lab-instances
EOF

echo "▶ Installing CRD..."
kubectl apply -f "$(dirname "$0")/../crd/labinstance_v1.yaml"

echo "▶ Creating auth public key secret..."
if [[ ! -f "$AUTH_PUBLIC_KEY_PATH" ]]; then
  echo "  ⚠ Auth public key not found at $AUTH_PUBLIC_KEY_PATH"
  echo "  Run 'make gen-keys' in services/auth first."
  exit 1
fi

kubectl -n "$NAMESPACE" create secret generic auth-jwt-public-key \
  --from-file=jwt-public.pem="$AUTH_PUBLIC_KEY_PATH" \
  --dry-run=client -o yaml | apply

echo "▶ Creating DB credentials secret..."
DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -base64 32)}"
kubectl -n "$NAMESPACE" create secret generic orchestrator-db \
  --from-literal=host="${DB_HOST:-postgres.databases.svc}" \
  --from-literal=port="${DB_PORT:-5432}" \
  --from-literal=dbname="${DB_NAME:-offcon}" \
  --from-literal=user="${DB_USER:-svc_orchestrator}" \
  --from-literal=password="$DB_PASSWORD" \
  --dry-run=client -o yaml | apply

echo "▶ Creating Redis secret..."
kubectl -n "$NAMESPACE" create secret generic orchestrator-redis \
  --from-literal=addr="${REDIS_ADDR:-redis.databases.svc:6379}" \
  --from-literal=password="${REDIS_PASSWORD:-}" \
  --dry-run=client -o yaml | apply

echo "▶ Creating flag HMAC secret..."
FLAG_SECRET="${FLAG_HMAC_SECRET:-$(openssl rand -base64 48)}"
kubectl -n "$NAMESPACE" create secret generic orchestrator-flag \
  --from-literal=hmac-secret="$FLAG_SECRET" \
  --dry-run=client -o yaml | apply

if [[ -n "${PROXMOX_ENDPOINT:-}" ]]; then
  echo "▶ Creating Proxmox secret..."
  kubectl -n "$NAMESPACE" create secret generic orchestrator-proxmox \
    --from-literal=endpoint="$PROXMOX_ENDPOINT" \
    --from-literal=token-id="${PROXMOX_TOKEN_ID:-}" \
    --from-literal=token-secret="${PROXMOX_TOKEN_SECRET:-}" \
    --dry-run=client -o yaml | apply
fi

if [[ -n "${WIREGUARD_API_KEY:-}" ]]; then
  echo "▶ Creating WireGuard API secret..."
  kubectl -n "$NAMESPACE" create secret generic orchestrator-wg \
    --from-literal=api-key="$WIREGUARD_API_KEY" \
    --dry-run=client -o yaml | apply
fi

echo ""
echo "✓ RBAC and secrets configured in namespace '$NAMESPACE'"
echo ""
echo "Now run: kubectl apply -f deployments/kubernetes.yaml"
