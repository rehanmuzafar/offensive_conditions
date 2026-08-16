"""Celery tasks: stats rollups, reputation, markdown rendering, notifications."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from celery import shared_task
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.logging import get_logger
from app.services.votes import ReputationService
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
def recompute_thread_stats(self) -> dict:
    """Fix denormalized reply_count + unique_posters + last_post_at."""
    engine = _sync_engine()
    updated = 0
    with Session(engine) as session:
        result = session.execute(
            text(
                """
                UPDATE forum.threads AS t
                SET reply_count = sub.reply_count,
                    unique_posters = sub.unique_posters,
                    last_post_at = COALESCE(sub.last_post_at, t.last_post_at),
                    last_post_user_id = sub.last_user,
                    updated_at = NOW()
                FROM (
                    SELECT
                        thread_id,
                        COUNT(*) FILTER (WHERE NOT is_first_post AND NOT is_deleted) AS reply_count,
                        COUNT(DISTINCT author_id) FILTER (WHERE NOT is_deleted) AS unique_posters,
                        MAX(created_at) FILTER (WHERE NOT is_deleted) AS last_post_at,
                        (
                            SELECT author_id FROM forum.posts p2
                            WHERE p2.thread_id = p.thread_id AND NOT p2.is_deleted
                            ORDER BY created_at DESC LIMIT 1
                        ) AS last_user
                    FROM forum.posts p
                    GROUP BY thread_id
                ) sub
                WHERE t.id = sub.thread_id
                  AND (t.reply_count != sub.reply_count
                       OR t.unique_posters != sub.unique_posters)
                """
            )
        )
        updated = result.rowcount or 0
        session.commit()
    engine.dispose()
    log.info("recompute_thread_stats_done", updated=updated)
    return {"threads_updated": updated}


@shared_task(bind=True, autoretry_for=(Exception,), retry_backoff=True, max_retries=3)
def recompute_reputation(self) -> dict:
    """Recompute reputation for all users with forum activity.

    Formula:
        reputation = upvotes_received*10 - downvotes_received*2 + solutions*15
    """
    engine = _sync_engine()
    updated = 0
    with Session(engine) as session:
        result = session.execute(
            text(
                f"""
                INSERT INTO forum.user_reputation (
                    user_id, reputation,
                    upvotes_received, downvotes_received,
                    posts_count, threads_count, solutions_accepted,
                    last_recomputed_at, updated_at
                )
                SELECT
                    p.author_id,
                    GREATEST(0,
                        COALESCE(SUM(p.upvote_count), 0) * {ReputationService.UPVOTE_WEIGHT}
                        - COALESCE(SUM(p.downvote_count), 0) * {ReputationService.DOWNVOTE_WEIGHT}
                        + (
                            SELECT COUNT(*) * {ReputationService.SOLUTION_WEIGHT}
                            FROM forum.threads t
                            WHERE t.solved_post_id IN (
                                SELECT id FROM forum.posts WHERE author_id = p.author_id
                            )
                        )
                    ) AS reputation,
                    COALESCE(SUM(p.upvote_count), 0) AS upvotes_received,
                    COALESCE(SUM(p.downvote_count), 0) AS downvotes_received,
                    COUNT(*) FILTER (WHERE NOT p.is_deleted) AS posts_count,
                    (
                        SELECT COUNT(*) FROM forum.threads
                        WHERE author_id = p.author_id AND deleted_at IS NULL
                    ) AS threads_count,
                    (
                        SELECT COUNT(*) FROM forum.threads t
                        WHERE t.solved_post_id IN (
                            SELECT id FROM forum.posts WHERE author_id = p.author_id
                        )
                    ) AS solutions_accepted,
                    NOW(),
                    NOW()
                FROM forum.posts p
                WHERE NOT p.is_deleted
                GROUP BY p.author_id
                ON CONFLICT (user_id) DO UPDATE
                SET
                    reputation = EXCLUDED.reputation,
                    upvotes_received = EXCLUDED.upvotes_received,
                    downvotes_received = EXCLUDED.downvotes_received,
                    posts_count = EXCLUDED.posts_count,
                    threads_count = EXCLUDED.threads_count,
                    solutions_accepted = EXCLUDED.solutions_accepted,
                    last_recomputed_at = NOW(),
                    updated_at = NOW()
                """
            )
        )
        updated = result.rowcount or 0
        session.commit()
    engine.dispose()
    log.info("recompute_reputation_done", users_updated=updated)
    return {"users_updated": updated}


@shared_task(bind=True, autoretry_for=(Exception,), retry_backoff=True, max_retries=3)
def flush_view_counts(self) -> dict:
    """Drain pending view increments from Redis → Postgres.

    Placeholder; in production we use a Redis HINCRBY counter per thread and
    flush atomically here.
    """
    # Real impl:
    #   import redis from app.core.config
    #   keys = r.keys("forum:views:*")
    #   pipe = r.pipeline()
    #   for k in keys: pipe.getdel(k)
    #   counts = pipe.execute()
    #   bulk update Postgres
    return {"flushed": 0}


@shared_task(bind=True, autoretry_for=(Exception,), retry_backoff=True, max_retries=3)
def expire_deleted_posts(self, age_days: int = 30) -> dict:
    """Hard-delete soft-deleted posts older than age_days."""
    threshold = datetime.now(timezone.utc) - timedelta(days=age_days)
    engine = _sync_engine()
    with Session(engine) as session:
        result = session.execute(
            text(
                """
                DELETE FROM forum.posts
                WHERE is_deleted = TRUE AND deleted_at < :threshold
                RETURNING id
                """
            ),
            {"threshold": threshold},
        )
        deleted = len(result.fetchall())
        session.commit()
    engine.dispose()
    log.info("expire_deleted_posts_done", deleted=deleted)
    return {"posts_hard_deleted": deleted}


@shared_task(bind=True, autoretry_for=(Exception,), retry_backoff=True, max_retries=3)
def render_pending_markdown(self, batch_size: int = 100) -> dict:
    """Render content_html for posts where it's NULL."""
    engine = _sync_engine()
    rendered = 0
    with Session(engine) as session:
        rows = session.execute(
            text(
                """
                SELECT id, content_markdown
                FROM forum.posts
                WHERE content_html IS NULL AND is_deleted = FALSE
                ORDER BY created_at DESC
                LIMIT :n
                """
            ),
            {"n": batch_size},
        ).all()
        for row in rows:
            html = render_safe_html(row.content_markdown)
            session.execute(
                text("UPDATE forum.posts SET content_html = :html WHERE id = :id"),
                {"id": row.id, "html": html},
            )
            rendered += 1
        session.commit()
    engine.dispose()
    if rendered:
        log.info("render_pending_markdown_done", rendered=rendered)
    return {"posts_rendered": rendered}


@shared_task(bind=True, autoretry_for=(Exception,), retry_backoff=True, max_retries=3)
def notify_subscribers(self, thread_id: str, post_id: str, author_id: str) -> dict:
    """Send notifications to thread subscribers (in-app + email).

    In production: writes to a notifications service via Kafka, or directly
    invokes notification-svc HTTP API.
    """
    engine = _sync_engine()
    with Session(engine) as session:
        subs = session.execute(
            text(
                """
                SELECT user_id, email_notifications, in_app_notifications
                FROM forum.thread_subscriptions
                WHERE thread_id = :tid AND user_id != :author
                """
            ),
            {"tid": thread_id, "author": author_id},
        ).all()
    engine.dispose()
    # Hand off to notification-svc here
    log.info(
        "notify_subscribers_scheduled",
        thread_id=thread_id,
        post_id=post_id,
        subscriber_count=len(subs),
    )
    return {"subscribers_notified": len(subs)}
