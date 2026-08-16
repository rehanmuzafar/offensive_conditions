"""Seed dev forum: categories, threads, posts.

Usage: python -m scripts.seed_dev_forum
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import text  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.core.logging import configure_logging  # noqa: E402
from app.db.session import close_db, get_session_factory, init_db  # noqa: E402

ADMIN_ID = "11111111-1111-1111-1111-111111111111"
ALICE_ID = "22222222-2222-2222-2222-222222222222"
BOB_ID = "33333333-3333-3333-3333-333333333333"

CATEGORIES = [
    ("general", "General Discussion", "Anything offensive-security related"),
    ("machines", "Machines", "Help and discussion about active machines"),
    ("challenges", "Challenges", "Challenge talk"),
    ("ctf", "CTF Events", "Discuss live and past CTFs"),
    ("career", "Career", "Jobs, certs, interviews"),
    ("announcements", "Announcements", "Platform news"),
]

THREADS = [
    (
        "general",
        "Welcome to the forums!",
        "Introduce yourself and tell us what you're working on.",
        ADMIN_ID,
        True,
        True,
        [("Glad to be here.", ALICE_ID), ("Lurking from Karachi.", BOB_ID)],
    ),
    (
        "machines",
        "Stuck on Blue Monday user flag",
        "I've enumerated SMB but can't get a foothold. Any hints?",
        ALICE_ID,
        False,
        False,
        [("Look at the print spooler.", BOB_ID)],
    ),
    (
        "challenges",
        "RSA Too Small writeup discussion",
        "Anyone want to compare approaches?",
        BOB_ID,
        False,
        False,
        [],
    ),
]


async def seed() -> None:
    settings = get_settings()
    configure_logging(settings)
    init_db(settings)
    factory = get_session_factory()

    async with factory() as session:
        cat_ids: dict[str, str] = {}
        for slug, name, desc in CATEGORIES:
            row = await session.execute(
                text(
                    """
                    INSERT INTO forum.categories (slug, name, description)
                    VALUES (:slug, :name, :desc)
                    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
                    RETURNING id
                    """
                ),
                {"slug": slug, "name": name, "desc": desc},
            )
            cat_ids[slug] = str(row.scalar_one())

        for cat_slug, title, body, author, pinned, announce, replies in THREADS:
            from app.utils.slug import slugify

            slug = slugify(title)
            row = await session.execute(
                text(
                    """
                    INSERT INTO forum.threads (
                        category_id, author_id, title, slug,
                        status, is_pinned, is_announcement
                    )
                    VALUES (
                        :cat, :author, :title, :slug,
                        'open', :pinned, :announce
                    )
                    ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title
                    RETURNING id
                    """
                ),
                {
                    "cat": cat_ids[cat_slug],
                    "author": author,
                    "title": title,
                    "slug": slug,
                    "pinned": pinned,
                    "announce": announce,
                },
            )
            thread_id = str(row.scalar_one())

            # First post
            await session.execute(
                text(
                    """
                    INSERT INTO forum.posts (
                        thread_id, author_id, content_markdown, is_first_post
                    )
                    VALUES (:tid, :author, :body, TRUE)
                    ON CONFLICT DO NOTHING
                    """
                ),
                {"tid": thread_id, "author": author, "body": body},
            )

            for reply_body, replier in replies:
                await session.execute(
                    text(
                        """
                        INSERT INTO forum.posts (thread_id, author_id, content_markdown)
                        VALUES (:tid, :author, :body)
                        """
                    ),
                    {"tid": thread_id, "author": replier, "body": reply_body},
                )

        await session.commit()
        print("Forum seed complete.")
        print(f"  categories: {len(CATEGORIES)}")
        print(f"  threads:    {len(THREADS)}")

    await close_db()


if __name__ == "__main__":
    asyncio.run(seed())
