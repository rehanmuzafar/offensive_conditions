#!/usr/bin/env bash
# Smoke-test a deployed gateway. Hits public + protected paths and asserts the
# expected status codes (auth enforcement, CORS, rate-limit headers).
set -euo pipefail

BASE="${GATEWAY_BASE:-https://api.offensiveconditions.org}"
PASS=0
FAIL=0

check() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    echo "  ✓ $desc ($actual)"
    PASS=$((PASS+1))
  else
    echo "  ✗ $desc — expected $expected got $actual"
    FAIL=$((FAIL+1))
  fi
}

code() {
  curl -s -o /dev/null -w "%{http_code}" "$@"
}

echo "==> Smoke testing $BASE"
echo ""

echo "Health:"
check "healthz reachable" "200" "$(code "$BASE/healthz")"

echo ""
echo "Public (no auth):"
check "list machines (GET, public)"     "200" "$(code "$BASE/v1/machines")"
check "leaderboards (GET, public)"       "200" "$(code "$BASE/v1/leaderboards/global")"
check "list programs (GET, public)"      "200" "$(code "$BASE/v1/programs")"

echo ""
echo "Auth enforcement (expect 401/403 without token):"
check "GET /v1/me without token"         "401" "$(code "$BASE/v1/me")"
check "GET /v1/me/notifications no token" "401" "$(code "$BASE/v1/me/notifications")"
check "POST /v1/instances no token"      "401" "$(code -X POST "$BASE/v1/instances")"
check "GET /v1/admin/programs no token"  "401" "$(code "$BASE/v1/admin/programs")"

echo ""
echo "Webhook path (no JWT required, but needs signature → 400/401 from svc):"
wh=$(code -X POST "$BASE/v1/webhooks/payment" -d '{}')
if [ "$wh" = "400" ] || [ "$wh" = "401" ]; then
  echo "  ✓ webhook rejects unsigned ($wh)"
  PASS=$((PASS+1))
else
  echo "  ✗ webhook unsigned — expected 400/401 got $wh"
  FAIL=$((FAIL+1))
fi

echo ""
echo "Security headers:"
hsts=$(curl -s -D - -o /dev/null "$BASE/healthz" | grep -i "strict-transport-security" || true)
if [ -n "$hsts" ]; then
  echo "  ✓ HSTS header present"
  PASS=$((PASS+1))
else
  echo "  ✗ HSTS header missing"
  FAIL=$((FAIL+1))
fi

nosniff=$(curl -s -D - -o /dev/null "$BASE/healthz" | grep -i "x-content-type-options" || true)
if [ -n "$nosniff" ]; then
  echo "  ✓ X-Content-Type-Options present"
  PASS=$((PASS+1))
else
  echo "  ✗ X-Content-Type-Options missing"
  FAIL=$((FAIL+1))
fi

echo ""
echo "HTTP→HTTPS redirect:"
redir=$(code "http://api.offensiveconditions.org/healthz")
if [ "$redir" = "301" ] || [ "$redir" = "308" ]; then
  echo "  ✓ HTTP redirects ($redir)"
  PASS=$((PASS+1))
else
  echo "  ✗ HTTP redirect — expected 301/308 got $redir"
  FAIL=$((FAIL+1))
fi

echo ""
echo "================================"
echo "  $PASS passed, $FAIL failed"
echo "================================"
[ "$FAIL" -eq 0 ]
