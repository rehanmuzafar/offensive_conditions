"""Seed dev writeups + comments + bookmarks.

Usage: python -m scripts.seed_dev_writeup
"""

from __future__ import annotations

import asyncio
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import text  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.core.logging import configure_logging  # noqa: E402
from app.db.session import close_db, get_session_factory, init_db  # noqa: E402
from app.utils.slug import slugify  # noqa: E402

ADMIN_ID = "11111111-1111-1111-1111-111111111111"
ALICE_ID = "22222222-2222-2222-2222-222222222222"
BOB_ID = "33333333-3333-3333-3333-333333333333"

# Fake machine IDs used elsewhere in dev fixtures
MACHINE_BLUE_MONDAY = "aaaa1111-1111-1111-1111-111111111111"
MACHINE_GROCK = "aaaa2222-2222-2222-2222-222222222222"


def _count_words(text: str) -> int:
    return len(re.findall(r"\b\w+\b", text))


WRITEUPS = [
    {
        "author": ALICE_ID,
        "content_type": "machine",
        "content_id": MACHINE_BLUE_MONDAY,
        "title": "Blue Monday — full root path",
        "summary": "Spooler + Kerberoasting + DCSync.",
        "language": "en",
        "tags": ["windows", "active-directory", "kerberoasting"],
        "techniques_used": ["printerbug", "kerberoasting", "dcsync"],
        "tools_used": ["nmap", "impacket", "bloodhound"],
        "status": "approved",
        "body": (
            "# Blue Monday Writeup\n\n"
            "## Enumeration\n\nFirst, we enumerate via nmap to find SMB and "
            "Kerberos services exposed. " * 30
        ),
    },
    {
        "author": BOB_ID,
        "content_type": "machine",
        "content_id": MACHINE_GROCK,
        "title": "Grock — heap exploitation",
        "summary": "Fastbin attack + ROP to spawn shell.",
        "language": "en",
        "tags": ["linux", "pwn", "heap"],
        "techniques_used": ["fastbin_attack", "rop"],
        "tools_used": ["gdb", "pwntools"],
        "status": "approved",
        "body": (
            "# Grock Writeup\n\n"
            "## Background\n\nThis box uses an older libc with predictable "
            "tcache behaviour. " * 30
        ),
    },
    {
        "author": ALICE_ID,
        "content_type": "machine",
        "content_id": MACHINE_BLUE_MONDAY,
        "title": "Blue Monday — Urdu walkthrough",
        "summary": "Step-by-step Urdu mein.",
        "language": "ur",
        "tags": ["windows", "urdu", "beginner-friendly"],
        "techniques_used": ["printerbug"],
        "tools_used": ["nmap", "impacket"],
        "status": "pending",
        "body": (
            "# Blue Monday — Urdu Walkthrough\n\n"
            "Pehle hum nmap chalate hain saare TCP ports scan karne ke liye. "
            * 30
        ),
    },
]


async def seed() -> None:
    settings = get_settings()
    configure_logging(settings)
    init_db(settings)
    factory = get_session_factory()

    async with factory() as session:
        for w in WRITEUPS:
            word_count = _count_words(w["body"])
            read_time = max(1, math.ceil(word_count / 200))
            slug = slugify(w["title"])

            await session.execute(
                text(
                    """
                    INSERT INTO writeup.writeups (
                        author_id, content_type, content_id,
                        title, slug, summary, content_markdown,
                        language, word_count, read_time_minutes,
                        tags, techniques_used, tools_used,
                        status, published_at
                    )
                    VALUES (
                        :author, :ct, :cid::UUID,
                        :title, :slug, :summary, :body,
                        :lang, :wc, :rt,
                        :tags, :tech, :tools,
                        :status, CASE WHEN :status = 'approved' THEN NOW() ELSE NULL END
                    )
                    ON CONFLICT (slug) DO UPDATE
                        SET title = EXCLUDED.title,
                            summary = EXCLUDED.summary,
                            status = EXCLUDED.status
                    """
                ),
                {
                    "author": w["author"],
                    "ct": w["content_type"],
                    "cid": w["content_id"],
                    "title": w["title"],
                    "slug": slug,
                    "summary": w["summary"],
                    "body": w["body"],
                    "lang": w["language"],
                    "wc": word_count,
                    "rt": read_time,
                    "tags": w["tags"],
                    "tech": w["techniques_used"],
                    "tools": w["tools_used"],
                    "status": w["status"],
                },
            )

        await session.commit()
        print("Writeup seed complete.")
        for w in WRITEUPS:
            print(f"  [{w['status']}] {w['title']}")

    await close_db()


if __name__ == "__main__":
    asyncio.run(seed())
