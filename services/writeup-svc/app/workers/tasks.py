"""Celery tasks: markdown render, stats, view rollup, archival."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from celery import shared_task
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.logging import get_logger
from app.utils.markdown import render_safe_html

log = get_logger("workers")


def _sync_engine():
    settings = get_settings()
    return create_engine(
        settings.database_sync_url,
        pool_pre_ping=True,
        pool_size=2,
        max_overflow=4,
    )


@shared_task(bind=True, autoretry_for=(Exception,), retry_backoff=True, max_retries=3)
def render_writeup_markdown(self, batch_size: int = 50) -> dict:
    """Render content_html for writeups where it's NULL."""
    engine = _sync_engine()
    rendered = 0
    with Session(engine) as session:
        rows = session.execute(
            text(
                """
                SELECT id, content_markdown
                FROM writeup.writeups
                WHERE content_html IS NULL AND deleted_at IS NULL
                ORDER BY created_at DESC
                LIMIT :n
                """
            ),
            {"n": batch_size},
        ).all()
        for row in rows:
            html = render_safe_html(row.content_markdown)
            session.execute(
                text(
                    "UPDATE writeup.writeups SET content_html = :html WHERE id = :id"
                ),
                {"id": row.id, "html": html},
            )
            rendered += 1

        # Same for comments
        crows = session.execute(
            text(
                """
                SELECT id, content_markdown
                FROM writeup.comments
                WHERE content_html IS NULL AND is_deleted = FALSE
                ORDER BY created_at DESC
                LIMIT :n
                """
            ),
            {"n": batch_size},
        ).all()
        for row in crows:
            html = render_safe_html(row.content_markdown)
            session.execute(
                text(
                    "UPDATE writeup.comments SET content_html = :html WHERE id = :id"
                ),
                {"id": row.id, "html": html},
            )
            rendered += 1

        session.commit()
    engine.dispose()
    if rendered:
        log.info("render_writeup_markdown_done", rendered=rendered)
    return {"rendered": rendered}


@shared_task(bind=True, autoretry_for=(Exception,), retry_backoff=True, max_retries=3)
def recompute_writeup_stats(self) -> dict:
    """Fix denormalized comment_count, bookmark_count, score per writeup."""
    engine = _sync_engine()
    updated = 0
    with Session(engine) as session:
        # Comment count
        c_result = session.execute(
            text(
                """
                UPDATE writeup.writeups AS w
                SET comment_count = sub.cnt, updated_at = NOW()
                FROM (
                    SELECT writeup_id, COUNT(*) AS cnt
                    FROM writeup.comments
                    WHERE is_deleted = FALSE
                    GROUP BY writeup_id
                ) sub
                WHERE w.id = sub.writeup_id
                  AND w.comment_count != sub.cnt
                """
            )
        )
        updated += c_result.rowcount or 0

        # Bookmark count
        b_result = session.execute(
            text(
                """
                UPDATE writeup.writeups AS w
                SET bookmark_count = sub.cnt, updated_at = NOW()
                FROM (
                    SELECT writeup_id, COUNT(*) AS cnt
                    FROM writeup.bookmarks
                    GROUP BY writeup_id
                ) sub
                WHERE w.id = sub.writeup_id
                  AND w.bookmark_count != sub.cnt
                """
            )
        )
        updated += b_result.rowcount or 0

        # Vote rollups (writeup-level)
        v_result = session.execute(
            text(
                """
                UPDATE writeup.writeups AS w
                SET
                    upvote_count = COALESCE(sub.up_cnt, 0),
                    downvote_count = COALESCE(sub.down_cnt, 0),
                    score = COALESCE(sub.up_cnt, 0) - COALESCE(sub.down_cnt, 0),
                    updated_at = NOW()
                FROM (
                    SELECT writeup_id,
                        COUNT(*) FILTER (WHERE direction = 1) AS up_cnt,
                        COUNT(*) FILTER (WHERE direction = -1) AS down_cnt
                    FROM writeup.votes
                    GROUP BY writeup_id
                ) sub
                WHERE w.id = sub.writeup_id
                  AND (w.upvote_count != COALESCE(sub.up_cnt, 0)
                       OR w.downvote_count != COALESCE(sub.down_cnt, 0))
                """
            )
        )
        updated += v_result.rowcount or 0

        session.commit()
    engine.dispose()
    if updated:
        log.info("recompute_writeup_stats_done", updated_rows=updated)
    return {"updated": updated}


@shared_task(bind=True, autoretry_for=(Exception,), retry_backoff=True, max_retries=3)
def flush_view_counts(self) -> dict:
    """Placeholder: drain Redis view counters → Postgres."""
    return {"flushed": 0}


@shared_task(bind=True, autoretry_for=(Exception,), retry_backoff=True, max_retries=3)
def archive_old_rejected(self, age_days: int = 90) -> dict:
    """Auto-archive rejected writeups older than age_days."""
    threshold = datetime.now(timezone.utc) - timedelta(days=age_days)
    engine = _sync_engine()
    with Session(engine) as session:
        result = session.execute(
            text(
                """
                UPDATE writeup.writeups
                SET status = 'archived', updated_at = NOW()
                WHERE status = 'rejected' AND moderated_at < :threshold
                RETURNING id
                """
            ),
            {"threshold": threshold},
        )
        archived = len(result.fetchall())
        session.commit()
    engine.dispose()
    log.info("archive_old_rejected_done", archived=archived)
    return {"archived": archived}
