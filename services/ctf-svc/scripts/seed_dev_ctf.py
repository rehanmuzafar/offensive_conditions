"""Seed a sample CTF event for development.

Usage:
    python -m scripts.seed_dev_ctf
"""

from __future__ import annotations

import asyncio
import hashlib
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import text  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.core.logging import configure_logging  # noqa: E402
from app.db.session import close_db, get_session_factory, init_db  # noqa: E402


ADMIN_ID = "11111111-1111-1111-1111-111111111111"


def sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


CHALLENGES = [
    # (name, category, difficulty, description, base_points, flag, hints)
    (
        "Welcome Aboard",
        "misc",
        "very_easy",
        "Find the flag in the description.",
        100,
        "OFFCON{welcome_to_the_arena}",
        [
            {"id": "h1", "text": "Read carefully.", "point_deduction": 10},
        ],
    ),
    (
        "Basic SQL",
        "web",
        "easy",
        "Bypass the login form to get the flag.",
        250,
        "OFFCON{sqli_basics_pwned}",
        [
            {"id": "h1", "text": "Try a comment trick.", "point_deduction": 25},
            {"id": "h2", "text": "Use OR 1=1.", "point_deduction": 50},
        ],
    ),
    (
        "RSA Sandbox",
        "crypto",
        "medium",
        "p, q, e, c provided. Recover plaintext.",
        400,
        "OFFCON{rsa_small_primes}",
        [
            {"id": "h1", "text": "Factor n into p,q.", "point_deduction": 50},
        ],
    ),
    (
        "ROP Cafeteria",
        "pwn",
        "hard",
        "Build a ROP chain to spawn a shell.",
        600,
        "OFFCON{rop_chain_complete}",
        [],
    ),
]


async def seed() -> None:
    settings = get_settings()
    configure_logging(settings)
    init_db(settings)
    factory = get_session_factory()

    now = datetime.now(timezone.utc)
    reg_start = now - timedelta(hours=1)
    reg_end = now + timedelta(hours=1)
    start = now + timedelta(hours=1)
    end = now + timedelta(hours=7)
    freeze = end - timedelta(hours=1)

    async with factory() as session:
        # Create event
        result = await session.execute(
            text(
                """
                INSERT INTO ctf.events (
                    slug, name, description, overview_markdown,
                    format, visibility, team_play, solo_play, max_team_size,
                    registration_starts_at, registration_ends_at, starts_at, ends_at,
                    scoreboard_freeze_at,
                    dynamic_scoring, min_points, first_blood_bonus,
                    required_tier, status, rules_markdown,
                    created_by
                )
                VALUES (
                    'spring-jam-2026', 'Spring Jam 2026',
                    'Demo CTF for testing.', '# Spring Jam\n\nWelcome!',
                    'jeopardy', 'public', TRUE, TRUE, 4,
                    :reg_s, :reg_e, :start, :end,
                    :freeze,
                    TRUE, 50, 0,
                    'free', 'registration',
                    '# Rules\n\nNo cheating.',
                    :creator
                )
                ON CONFLICT (slug) DO UPDATE
                    SET name = EXCLUDED.name,
                        registration_starts_at = EXCLUDED.registration_starts_at,
                        registration_ends_at = EXCLUDED.registration_ends_at,
                        starts_at = EXCLUDED.starts_at,
                        ends_at = EXCLUDED.ends_at,
                        scoreboard_freeze_at = EXCLUDED.scoreboard_freeze_at,
                        status = EXCLUDED.status
                RETURNING id
                """
            ),
            {
                "reg_s": reg_start,
                "reg_e": reg_end,
                "start": start,
                "end": end,
                "freeze": freeze,
                "creator": ADMIN_ID,
            },
        )
        event_id = str(result.scalar_one())

        # Delete + re-insert challenges (idempotent reseed)
        await session.execute(
            text("DELETE FROM ctf.event_challenges WHERE event_id = :eid"),
            {"eid": event_id},
        )
        import json
        for sort_order, (name, cat, diff, desc, pts, flag, hints) in enumerate(CHALLENGES):
            await session.execute(
                text(
                    """
                    INSERT INTO ctf.event_challenges (
                        event_id, name, category, difficulty, description,
                        base_points, current_points,
                        static_flag_hash, hints, sort_order
                    )
                    VALUES (
                        :eid, :name, :cat, :diff, :desc,
                        :pts, :pts,
                        :flag_hash, :hints::JSONB, :sort
                    )
                    """
                ),
                {
                    "eid": event_id,
                    "name": name,
                    "cat": cat,
                    "diff": diff,
                    "desc": desc,
                    "pts": pts,
                    "flag_hash": sha256_hex(flag),
                    "hints": json.dumps(hints),
                    "sort": sort_order,
                },
            )

        await session.commit()
        print("Seed complete.")
        print(f"  Event: spring-jam-2026 ({event_id})")
        print(f"  Status: registration → live at {start}")
        print(f"  Challenges: {len(CHALLENGES)}")
        for name, _, _, _, pts, flag, _ in CHALLENGES:
            print(f"    [{pts} pts] {name}  →  flag: {flag}")

    await close_db()


if __name__ == "__main__":
    asyncio.run(seed())
