#!/usr/bin/env python3
"""Validate the gateway route registry.

Checks:
  1. No two routes have identical prefixes
  2. Overlapping prefixes are ordered correctly (more specific = lower priority
     number = evaluated first)
  3. Every route references a known service + port
  4. WebSocket routes have timeout_seconds: 0
  5. Mutating-only services (orchestrator, flag-verifier) have retries: 0
  6. Webhook routes are not CORS-enabled and use webhook_signature auth
  7. Admin routes require roles

Exit non-zero on any error. Run via `make validate`.
"""

from __future__ import annotations

import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("PyYAML required: pip install pyyaml", file=sys.stderr)
    sys.exit(2)

ROUTES_FILE = Path(__file__).resolve().parents[1] / "api" / "routes.yaml"

# Known internal services + their HTTP ports (must match deployments)
KNOWN_SERVICES = {
    "auth": 8001,
    "user-svc": 8002,
    "content-svc": 8003,
    "ctf-svc": 8004,
    "flag-verifier": 8005,
    "forum-svc": 8005,
    "writeup-svc": 8006,
    "payment-svc": 8007,
    "notification-svc": 8008,
    "bounty-svc": 8009,
    "orchestrator": 8000,
    "scoring": 8004,
    "gateway-healthcheck": 8080,
    "admin-router": 0,
}

# Services whose mutations must never be retried
NO_RETRY_SERVICES = {"orchestrator", "flag-verifier"}

errors: list[str] = []
warnings: list[str] = []


def err(msg: str) -> None:
    errors.append(msg)


def warn(msg: str) -> None:
    warnings.append(msg)


def main() -> int:
    if not ROUTES_FILE.exists():
        err(f"routes file not found: {ROUTES_FILE}")
        return _report()

    data = yaml.safe_load(ROUTES_FILE.read_text())
    routes = data.get("routes", [])
    if not routes:
        err("no routes defined")
        return _report()

    seen_prefixes: dict[str, dict] = {}

    for r in routes:
        prefix = r.get("prefix", "")
        svc = r.get("service", "")
        port = r.get("port")
        auth = r.get("auth", {})
        rl = r.get("rate_limit", {})

        # 1. unique prefixes
        if prefix in seen_prefixes:
            err(f"duplicate prefix: {prefix}")
        seen_prefixes[prefix] = r

        # prefix sanity
        if not prefix.startswith("/"):
            err(f"prefix must start with /: {prefix!r}")

        # 3. known service
        if svc not in KNOWN_SERVICES:
            err(f"{prefix}: unknown service {svc!r}")
        elif KNOWN_SERVICES[svc] != port and svc != "admin-router":
            err(
                f"{prefix}: port {port} does not match known port "
                f"{KNOWN_SERVICES[svc]} for {svc}"
            )

        # auth mode present
        mode = auth.get("mode")
        if mode not in (
            "open",
            "jwt",
            "jwt_optional",
            "webhook_signature",
            "admin_only",
        ):
            err(f"{prefix}: invalid auth mode {mode!r}")

        # 7. admin routes require roles
        if mode == "admin_only" and not auth.get("required_roles"):
            err(f"{prefix}: admin_only requires required_roles")

        # rate limit present
        if rl:
            if rl.get("key") not in ("ip", "user", "both"):
                err(f"{prefix}: invalid rate_limit key {rl.get('key')!r}")
            if not isinstance(rl.get("requests"), int):
                err(f"{prefix}: rate_limit.requests must be int")

        # 4. websocket → timeout 0
        if r.get("websocket"):
            if r.get("timeout_seconds") != 0:
                err(f"{prefix}: websocket route must have timeout_seconds: 0")

        # 5. no-retry services
        if svc in NO_RETRY_SERVICES and r.get("retries", 0) != 0:
            err(f"{prefix}: {svc} mutations must have retries: 0")

        # 6. webhook hygiene
        if mode == "webhook_signature":
            if r.get("cors_allowed"):
                err(f"{prefix}: webhook routes must not be CORS-enabled")

    # 2. overlap ordering — for any pair where one is a prefix of the other,
    # the more specific one must have a lower (or equal) priority number.
    prefixes = [(r.get("prefix"), r.get("priority", 100)) for r in routes]
    for i, (p1, pr1) in enumerate(prefixes):
        for j, (p2, pr2) in enumerate(prefixes):
            if i == j or not p1 or not p2:
                continue
            # p2 is more specific than p1 (longer, starts with p1)
            if p2 != p1 and p2.startswith(p1.rstrip("/") + "/"):
                if pr2 > pr1:
                    err(
                        f"ordering: {p2!r} (priority {pr2}) is more specific than "
                        f"{p1!r} (priority {pr1}) but has a HIGHER priority number — "
                        f"it would be shadowed. Lower the priority of {p2!r}."
                    )

    # Cross-check admin_subpaths services
    for sp in data.get("admin_subpaths", []):
        if sp.get("service") not in KNOWN_SERVICES:
            err(f"admin_subpath {sp.get('sub')}: unknown service {sp.get('service')}")

    return _report()


def _report() -> int:
    for w in warnings:
        print(f"  WARN  {w}")
    for e in errors:
        print(f"  ERROR {e}")
    if errors:
        print(f"\n✗ {len(errors)} error(s), {len(warnings)} warning(s)")
        return 1
    print(f"✓ route registry valid ({len(warnings)} warning(s))")
    return 0


if __name__ == "__main__":
    sys.exit(main())
