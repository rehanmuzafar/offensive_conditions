"""Forum-svc additions: trigram + ts_vector indexes for search.

Phase 2 created 7 tables. This adds search indexes + sub-query indexes.

Revision ID: 20260525_0001
Revises:
Create Date: 2026-05-25 10:00:00.000000
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

    # Thread title search
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_threads_title_trgm "
        "ON forum.threads USING gin (title gin_trgm_ops)"
    )

    # Thread tags (GIN for ANY()/contains)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_threads_tags_gin "
        "ON forum.threads USING gin (tags)"
    )

    # Posts list for a thread, ordered by created_at
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_posts_thread_created "
        "ON forum.posts (thread_id, created_at ASC) "
        "WHERE is_deleted = FALSE"
    )

    # Subscriptions by user (for `my-subscriptions` page)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_subscriptions_user_subscribed "
        "ON forum.thread_subscriptions (user_id, subscribed_at DESC)"
    )

    # Reports by status (for mod queue)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_reports_status_created "
        "ON forum.reports (status, created_at DESC)"
    )

    # Vote lookup (already in Phase 2 via PK, but we want descending score sort)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_posts_score_desc "
        "ON forum.posts (score DESC) WHERE is_deleted = FALSE"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS forum.idx_threads_title_trgm")
    op.execute("DROP INDEX IF EXISTS forum.idx_threads_tags_gin")
    op.execute("DROP INDEX IF EXISTS forum.idx_posts_thread_created")
    op.execute("DROP INDEX IF EXISTS forum.idx_subscriptions_user_subscribed")
    op.execute("DROP INDEX IF EXISTS forum.idx_reports_status_created")
    op.execute("DROP INDEX IF EXISTS forum.idx_posts_score_desc")
