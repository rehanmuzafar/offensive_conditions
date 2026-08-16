"""Business metric helpers for Python services (offcon_* series)."""

from __future__ import annotations

from prometheus_client import Counter, Gauge

from offcon_observability import REGISTRY

# content-svc / ctf-svc
ctf_solves = Counter(
    "offcon_ctf_solves_total", "CTF challenge solves.", ["event_id"], registry=REGISTRY
)
ctf_event_active = Gauge(
    "offcon_ctf_event_active", "Whether a CTF event is active (1/0).", ["event_id"], registry=REGISTRY
)

# bounty-svc
reports_submitted = Counter(
    "offcon_reports_submitted_total", "Bounty reports submitted.", ["program"], registry=REGISTRY
)

# forum-svc / writeup-svc
content_created = Counter(
    "offcon_content_created_total", "Forum/writeup content created.", ["kind"], registry=REGISTRY
)
