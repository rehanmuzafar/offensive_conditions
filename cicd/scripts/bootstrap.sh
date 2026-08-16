#!/usr/bin/env bash
# ============================================================================
#  bootstrap.sh — one-time cluster bootstrap for OFFCON GitOps.
#
#  Installs the ArgoCD AppProject, the environment ApplicationSet, and the
#  standalone Applications (gateway + observability). After this, ArgoCD owns
#  all further deploys — you never kubectl apply app manifests by hand again.
#
#  Prereqs: kubectl context pointed at the target cluster, ArgoCD already
#  installed in the `argocd` namespace, Istio + its CRDs installed, and the
#  required secrets created (see docs/SECRETS in the observability + this repo).
#
#  Usage: ./scripts/bootstrap.sh
# ============================================================================
set -euo pipefail

ARGOCD_NS="${ARGOCD_NS:-argocd}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Verifying prerequisites"
kubectl get ns "$ARGOCD_NS" >/dev/null 2>&1 || {
  echo "ERROR: namespace '$ARGOCD_NS' not found — install ArgoCD first." >&2
  exit 1
}

echo "==> Applying AppProject"
kubectl apply -f "$HERE/argocd/projects/offcon-project.yaml"

echo "==> Applying standalone Applications (gateway, observability)"
kubectl apply -f "$HERE/argocd/applications/gateway.yaml"
kubectl apply -f "$HERE/argocd/applications/observability.yaml"

echo "==> Applying environment ApplicationSet (staging + production)"
kubectl apply -f "$HERE/argocd/applicationsets/offcon-appset.yaml"

echo "==> Waiting for Applications to register"
sleep 5
kubectl -n "$ARGOCD_NS" get applications.argoproj.io -l 'app.kubernetes.io/part-of!=argocd' 2>/dev/null || \
  kubectl -n "$ARGOCD_NS" get applications.argoproj.io

cat <<'DONE'

==> Bootstrap complete.

ArgoCD will now reconcile:
  - offcon-gateway        (Istio mesh + gateway config)
  - offcon-observability  (Prometheus/Grafana/Loki/Tempo/...)
  - offcon-staging        (all 12 services + frontend, staging values)
  - offcon-production     (all 12 services + frontend, production values)

Watch progress:   argocd app list
Sync manually:     argocd app sync offcon-production
Open the UI:       argocd admin dashboard

From here, CI bumps image tags in git and ArgoCD auto-syncs. You're GitOps.
DONE
