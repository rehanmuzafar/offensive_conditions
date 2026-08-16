"""Seed sample content for local development.

Usage:
    python -m scripts.seed_dev_content

Creates a handful of categories, tags, machines, challenges, and one learning path.
Safe to re-run — uses INSERT ... ON CONFLICT DO NOTHING.
"""

from __future__ import annotations

import asyncio
import hashlib
import sys
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import text  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.core.logging import configure_logging  # noqa: E402
from app.db.session import close_db, get_session_factory, init_db  # noqa: E402


# Deterministic UUIDs so the seed is stable
ADMIN_ID = "11111111-1111-1111-1111-111111111111"

CATEGORIES = [
    ("web", "Web", "Web exploitation challenges"),
    ("crypto", "Crypto", "Cryptography puzzles"),
    ("pwn", "Pwn", "Binary exploitation"),
    ("forensics", "Forensics", "Disk + memory + network forensics"),
    ("reversing", "Reversing", "Reverse engineering"),
    ("misc", "Misc", "Anything else"),
]

TAGS = [
    ("sqli", "SQL Injection", "#e85d24"),
    ("xss", "XSS", "#f2a623"),
    ("buffer-overflow", "Buffer Overflow", "#c04828"),
    ("rsa", "RSA", "#1d9e75"),
    ("active-directory", "Active Directory", "#3266ad"),
    ("windows", "Windows", "#185fa5"),
    ("linux", "Linux", "#3b6d11"),
    ("nosql", "NoSQL Injection", "#993556"),
    ("oauth", "OAuth", "#534ab7"),
]

MACHINES = [
    # (slug, name, description, os, difficulty, tags, base_user, base_root)
    (
        "blue-monday",
        "Blue Monday",
        "A vulnerable Windows server with a misconfigured SMB share.",
        "windows", "easy", ["windows", "active-directory"], 10, 20,
    ),
    (
        "kafka-keys",
        "Kafka Keys",
        "Linux box exposing a poorly secured Kafka topic. Pivot to root via the broker config.",
        "linux", "medium", ["linux"], 20, 40,
    ),
    (
        "redteam-recon",
        "Red Team Recon",
        "Full enterprise AD lab with multiple chained vulnerabilities.",
        "windows", "hard", ["windows", "active-directory"], 30, 60,
    ),
    (
        "json-jungle",
        "JSON Jungle",
        "Modern REST API riddled with deserialization flaws.",
        "linux", "easy", ["linux", "nosql"], 10, 20,
    ),
]

CHALLENGES = [
    # (slug, name, description, category, difficulty, points, tags)
    (
        "rsa-too-small",
        "RSA Too Small",
        "Recover the plaintext given p, q, e, c. The modulus is small.",
        "crypto", "very_easy", 50, ["rsa"],
    ),
    (
        "blind-sql-bonanza",
        "Blind SQL Bonanza",
        "Boolean-based blind SQLi against a login form.",
        "web", "medium", 200, ["sqli"],
    ),
    (
        "stack-pancakes",
        "Stack Pancakes",
        "Classic ret2libc buffer overflow.",
        "pwn", "hard", 350, ["buffer-overflow"],
    ),
    (
        "xss-storage",
        "Stored XSS in Comments",
        "Find the stored XSS that lets you steal the admin's session.",
        "web", "easy", 100, ["xss"],
    ),
]


async def seed() -> None:
    settings = get_settings()
    configure_logging(settings)
    init_db(settings)
    factory = get_session_factory()

    async with factory() as session:
        # Categories
        cat_ids: dict[str, str] = {}
        for slug, name, desc in CATEGORIES:
            row = await session.execute(
                text(
                    """
                    INSERT INTO content.categories (slug, name, description)
                    VALUES (:slug, :name, :desc)
                    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
                    RETURNING id
                    """
                ),
                {"slug": slug, "name": name, "desc": desc},
            )
            cat_ids[slug] = str(row.scalar_one())

        # Tags
        tag_ids: dict[str, str] = {}
        for slug, name, color in TAGS:
            row = await session.execute(
                text(
                    """
                    INSERT INTO content.tags (slug, name, color)
                    VALUES (:slug, :name, :color)
                    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
                    RETURNING id
                    """
                ),
                {"slug": slug, "name": name, "color": color},
            )
            tag_ids[slug] = str(row.scalar_one())

        # Machines
        for slug, name, desc, os, diff, tags, user_pts, root_pts in MACHINES:
            row = await session.execute(
                text(
                    """
                    INSERT INTO content.machines (
                        slug, name, description, os, difficulty,
                        backend, image_ref, image_version,
                        base_user_points, base_root_points, base_challenge_points,
                        status, creator_id, released_at,
                        required_tier, intro_markdown,
                        has_user_flag, has_root_flag
                    )
                    VALUES (
                        :slug, :name, :desc, :os, :diff,
                        'container', :img, '1.0',
                        :upts, :rpts, :tpts,
                        'active', :creator, NOW(),
                        'free', :intro,
                        TRUE, TRUE
                    )
                    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
                    RETURNING id
                    """
                ),
                {
                    "slug": slug,
                    "name": name,
                    "desc": desc,
                    "os": os,
                    "diff": diff,
                    "img": f"harbor.offensiveconditions.org/machines/{slug}",
                    "upts": user_pts,
                    "rpts": root_pts,
                    "tpts": user_pts + root_pts,
                    "creator": ADMIN_ID,
                    "intro": f"# {name}\n\n{desc}\n\nGood luck!",
                },
            )
            machine_id = str(row.scalar_one())
            for tag_slug in tags:
                await session.execute(
                    text(
                        """
                        INSERT INTO content.machine_tags (machine_id, tag_id)
                        VALUES (:mid, :tid)
                        ON CONFLICT DO NOTHING
                        """
                    ),
                    {"mid": machine_id, "tid": tag_ids[tag_slug]},
                )

        # Challenges
        for slug, name, desc, cat, diff, pts, tags in CHALLENGES:
            row = await session.execute(
                text(
                    """
                    INSERT INTO content.challenges (
                        slug, name, description, category_id, difficulty, points,
                        status, creator_id, released_at, required_tier,
                        requires_instance, static_flag_hash
                    )
                    VALUES (
                        :slug, :name, :desc, :cat, :diff, :pts,
                        'active', :creator, NOW(), 'free',
                        FALSE, :flag_hash
                    )
                    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
                    RETURNING id
                    """
                ),
                {
                    "slug": slug,
                    "name": name,
                    "desc": desc,
                    "cat": cat_ids[cat],
                    "diff": diff,
                    "pts": pts,
                    "creator": ADMIN_ID,
                    # Jeopardy-style static flag; hash of a deterministic dev flag
                    # so the constraint (non-instance ⇒ static_flag_hash) is satisfied.
                    "flag_hash": hashlib.sha256(
                        f"OFFCON{{{slug}}}".encode()
                    ).hexdigest(),
                },
            )
            challenge_id = str(row.scalar_one())
            for tag_slug in tags:
                await session.execute(
                    text(
                        """
                        INSERT INTO content.challenge_tags (challenge_id, tag_id)
                        VALUES (:cid, :tid)
                        ON CONFLICT DO NOTHING
                        """
                    ),
                    {"cid": challenge_id, "tid": tag_ids[tag_slug]},
                )

        # One learning path
        row = await session.execute(
            text(
                """
                INSERT INTO content.learning_paths (
                    slug, name, description, overview_markdown,
                    difficulty, estimated_hours,
                    status, creator_id, released_at,
                    required_tier, completion_points
                )
                VALUES (
                    'web-recon-basics', 'Web Recon Basics',
                    'Start your offensive web journey: recon, fingerprinting, simple injections.',
                    '# Welcome\n\nLearn the foundations of web reconnaissance.',
                    'beginner', 8,
                    'active', :creator, NOW(),
                    'free', 100
                )
                ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
                RETURNING id
                """
            ),
            {"creator": ADMIN_ID},
        )
        path_id = str(row.scalar_one())

        # Two modules for the path
        modules = [
            (1, "Recon fundamentals", "Map a target like a pro.", "## Tools\n\n- nmap\n- whatweb", 30),
            (2, "Your first injection", "Use the JSON Jungle box.", "## Goal\n\nGet user shell.", 60),
        ]
        for seq, title, desc, body, mins in modules:
            await session.execute(
                text(
                    """
                    INSERT INTO content.path_modules (
                        path_id, sequence, title, description, content_markdown, estimated_minutes
                    )
                    VALUES (:pid, :seq, :title, :desc, :body, :mins)
                    ON CONFLICT (path_id, sequence) DO UPDATE SET title = EXCLUDED.title
                    """
                ),
                {"pid": path_id, "seq": seq, "title": title, "desc": desc, "body": body, "mins": mins},
            )

        await session.commit()
        print("Seed complete.")
        print(f"  categories: {len(CATEGORIES)}")
        print(f"  tags:       {len(TAGS)}")
        print(f"  machines:   {len(MACHINES)}")
        print(f"  challenges: {len(CHALLENGES)}")
        print(f"  path:       web-recon-basics ({len(modules)} modules)")

    await close_db()


if __name__ == "__main__":
    asyncio.run(seed())
