"""Writeup-svc additions: comment_votes + search indexes.

Phase 2 created writeups, votes, bookmarks, comments. This migration adds the
comment_votes table (Phase 2 didn't have per-comment voting) and search +
sort indexes for the write-heavy hot paths.

Revision ID: 20260525_0001
Revises:
Create Date: 2026-05-25 11:00:00.000000
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op


revision: str = "20260525_0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    # Comment votes (new table — Phase 2 only had writeup-level votes)
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS writeup.comment_votes (
            comment_id  UUID NOT NULL REFERENCES writeup.comments(id) ON DELETE CASCADE,
            user_id     UUID NOT NULL,
            direction   SMALLINT NOT NULL CHECK (direction IN (-1, 1)),
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (comment_id, user_id)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_comment_votes_user "
        "ON writeup.comment_votes (user_id)"
    )

    # Trigram index on writeup titles for search
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_writeups_title_trgm "
        "ON writeup.writeups USING gin (title gin_trgm_ops)"
    )

    # Status + published_at composite for moderation queue and listings
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_writeups_status_published "
        "ON writeup.writeups (status, published_at DESC NULLS LAST) "
        "WHERE deleted_at IS NULL"
    )

    # Tags GIN
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_writeups_tags_gin "
        "ON writeup.writeups USING gin (tags)"
    )

    # Techniques + tools (often filtered together)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_writeups_techniques_gin "
        "ON writeup.writeups USING gin (techniques_used)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_writeups_tools_gin "
        "ON writeup.writeups USING gin (tools_used)"
    )

    # Author lookup
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_writeups_author_status "
        "ON writeup.writeups (author_id, status, created_at DESC)"
    )

    # Target lookup (find writeups for a given machine/challenge)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_writeups_target "
        "ON writeup.writeups (content_type, content_id, score DESC) "
        "WHERE status = 'approved' AND deleted_at IS NULL"
    )

    # Comment list per writeup
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_comments_writeup_created "
        "ON writeup.comments (writeup_id, created_at ASC) "
        "WHERE is_deleted = FALSE"
    )

    # Bookmarks by user (for /me/bookmarks)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_bookmarks_user_created "
        "ON writeup.bookmarks (user_id, created_at DESC)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS writeup.idx_bookmarks_user_created")
    op.execute("DROP INDEX IF EXISTS writeup.idx_comments_writeup_created")
    op.execute("DROP INDEX IF EXISTS writeup.idx_writeups_target")
    op.execute("DROP INDEX IF EXISTS writeup.idx_writeups_author_status")
    op.execute("DROP INDEX IF EXISTS writeup.idx_writeups_tools_gin")
    op.execute("DROP INDEX IF EXISTS writeup.idx_writeups_techniques_gin")
    op.execute("DROP INDEX IF EXISTS writeup.idx_writeups_tags_gin")
    op.execute("DROP INDEX IF EXISTS writeup.idx_writeups_status_published")
    op.execute("DROP INDEX IF EXISTS writeup.idx_writeups_title_trgm")
    op.execute("DROP INDEX IF EXISTS writeup.idx_comment_votes_user")
    op.execute("DROP TABLE IF EXISTS writeup.comment_votes CASCADE")
