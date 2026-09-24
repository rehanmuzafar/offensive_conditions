#!/usr/bin/env bash
#
# Put the Safepay keys into .env without them appearing on screen, in your
# shell history, or in a file you have to find and edit by hand.
#
# Run it, paste each key when asked, press enter. Nothing is echoed.
#
#   ./deploy/set-safepay-keys.sh

set -euo pipefail
cd "$(dirname "$0")"

[[ -f .env ]] || { echo ".env not found next to this script" >&2; exit 1; }

set_var() {
  local key="$1" value="$2"
  if grep -qE "^${key}=" .env; then
    # awk, not sed: a key can contain characters sed would treat as part of the
    # replacement, and one of these is a secret worth not mangling.
    awk -v k="$key" -v v="$value" '
      BEGIN{FS=OFS="="}
      $1==k{print k "=" v; next}
      {print}
    ' .env > .env.tmp && mv .env.tmp .env
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}

echo
echo "Safepay keys — from the dashboard, Developer -> API."
echo "Nothing you type here is shown or saved to your shell history."
echo

read -r -s -p "  Public key  (sec_...) : " MK; echo
read -r -s -p "  Secret key  (hex)     : " MS; echo
read -r -s -p "  Webhook secret (blank if you have not made one yet) : " WS; echo
echo

[[ -n "$MK" ]] && set_var SAFEPAY_MERCHANT_KEY "$MK"
[[ -n "$MS" ]] && set_var SAFEPAY_MERCHANT_SECRET "$MS"
[[ -n "$WS" ]] && set_var SAFEPAY_WEBHOOK_SECRET "$WS"

# Report only the shape, never the value — enough to see it landed, useless to
# anyone reading over your shoulder or scrolling back through this terminal.
echo "Written to .env:"
for k in SAFEPAY_MERCHANT_KEY SAFEPAY_MERCHANT_SECRET SAFEPAY_WEBHOOK_SECRET; do
  v="$(grep -E "^${k}=" .env | head -1 | cut -d= -f2-)"
  if [[ -z "$v" ]]; then
    printf '  %-26s (empty)\n' "$k"
  else
    printf '  %-26s %s… (%d chars)\n' "$k" "${v:0:4}" "${#v}"
  fi
done
echo
echo "Now tell Claude, and the services will be restarted to pick them up."
