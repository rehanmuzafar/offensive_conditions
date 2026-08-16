#!/usr/bin/env bash
# Validate the route registry + lint all Istio YAML.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATEWAY_DIR="$(dirname "$SCRIPT_DIR")"

echo "==> Validating route registry"
python3 "$SCRIPT_DIR/validate.py"

echo ""
echo "==> Checking YAML syntax across all manifests"
fail=0
while IFS= read -r -d '' f; do
  if ! python3 -c "import yaml,sys; list(yaml.safe_load_all(open('$f')))" 2>/dev/null; then
    echo "  ERROR invalid YAML: $f"
    fail=1
  fi
done < <(find "$GATEWAY_DIR/deployments" -name '*.yaml' -print0)

if [ "$fail" -eq 0 ]; then
  echo "  ✓ all manifests parse"
else
  echo "  ✗ YAML errors found"
  exit 1
fi

# If istioctl is available, run analyze
if command -v istioctl >/dev/null 2>&1; then
  echo ""
  echo "==> istioctl analyze (dry-run against manifests)"
  istioctl analyze "$GATEWAY_DIR/deployments/routes/" \
                   "$GATEWAY_DIR/deployments/policies/" \
                   --use-kube=false || true
else
  echo ""
  echo "  (istioctl not found — skipping analyze)"
fi

echo ""
echo "✓ validation complete"
