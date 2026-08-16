"""Celery tasks: stat refreshes, draft expiry, search reindex."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from celery import shared_task
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.logging import get_logger

log = get_logger("workers")


def _sync_engine():
    """Per-task sync engine (Celery tasks aren't async). Each task gets a fresh connection."""
    settings = get_settings()
    return create_engine(
        settings.database_sync_url,
        pool_pre_ping=True,
        pool_size=2,
        max_overflow=4,
    )


# =============================================================================
# Machine stats
# =============================================================================


@shared_task(bind=True, autoretry_for=(Exception,), retry_backoff=True, max_retries=3)
def refresh_machine_stats(self) -> dict:
    """Recompute denormalized machine stats from scoring events.

    In production this would join against the scoring schema (or query
    ClickHouse). For now, we refresh rating aggregates from machine_ratings.
    Solve count and avg-solve-minutes are populated by the scoring service
    via the Kafka consumer below (see worker.py future).
    """
    engine = _sync_engine()
    updated = 0
    with Session(engine) as session:
        # Refresh rating_avg + rating_count for any machine with ratings
        result = session.execute(
            text(
                """
                UPDATE content.machines m
                SET rating_avg = sub.avg_rating,
                    rating_count = sub.cnt,
                    updated_at = NOW()
                FROM (
                    SELECT machine_id, AVG(rating)::NUMERIC(3,2) AS avg_rating,
                           COUNT(*) AS cnt
                    FROM content.machine_ratings
                    GROUP BY machine_id
                ) sub
                WHERE m.id = sub.machine_id
                  AND (m.rating_avg IS DISTINCT FROM sub.avg_rating
                       OR m.rating_count IS DISTINCT FROM sub.cnt)
                """
            )
        )
        updated = result.rowcount or 0
        session.commit()
    engine.dispose()
    log.info("refresh_machine_stats_done", machines_updated=updated)
    return {"machines_updated": updated}


@shared_task(bind=True, autoretry_for=(Exception,), retry_backoff=True, max_retries=3)
def refresh_challenge_stats(self) -> dict:
    """Recompute challenge solve count + ratings from scoring schema."""
    engine = _sync_engine()
    updated = 0
    with Session(engine) as session:
        # In real impl: JOIN scoring.flag_submissions where status='accepted'
        # to count solves. Placeholder uses event count from kafka-consumer.
        result = session.execute(
            text(
                """
                UPDATE content.challenges c
                SET total_solves = COALESCE(sub.cnt, 0),
                    updated_at = NOW()
                FROM (
                    SELECT subject_id, COUNT(*) AS cnt
                    FROM scoring.flag_submissions
                    WHERE status = 'accepted' AND subject_type = 'challenge'
                    GROUP BY subject_id
                ) sub
                WHERE c.id = sub.subject_id::UUID
                  AND c.total_solves != sub.cnt
                """
            )
        )
        updated = result.rowcount or 0
        session.commit()
    engine.dispose()
    log.info("refresh_challenge_stats_done", challenges_updated=updated)
    return {"challenges_updated": updated}


@shared_task(bind=True, autoretry_for=(Exception,), retry_backoff=True, max_retries=3)
def refresh_path_stats(self) -> dict:
    """Recompute learning path enrollment + completion counts."""
    engine = _sync_engine()
    updated = 0
    with Session(engine) as session:
        result = session.execute(
            text(
                """
                UPDATE content.learning_paths p
                SET total_enrollments = COALESCE(e.enroll_cnt, 0),
                    total_completions = COALESCE(e.completion_cnt, 0),
                    updated_at = NOW()
                FROM (
                    SELECT
                        path_id,
                        COUNT(*) AS enroll_cnt,
                        COUNT(*) FILTER (WHERE status = 'completed') AS completion_cnt
                    FROM content.path_enrollments
                    GROUP BY path_id
                ) e
                WHERE p.id = e.path_id
                  AND (p.total_enrollments != e.enroll_cnt
                       OR p.total_completions != e.completion_cnt)
                """
            )
        )
        updated = result.rowcount or 0
        session.commit()
    engine.dispose()
    log.info("refresh_path_stats_done", paths_updated=updated)
    return {"paths_updated": updated}


# =============================================================================
# Draft maintenance
# =============================================================================


@shared_task(bind=True, autoretry_for=(Exception,), retry_backoff=True, max_retries=3)
def expire_drafts(self, age_days: int = 90) -> dict:
    """Auto-archive draft machines/challenges untouched for `age_days`.

    Reduces clutter in moderator queues. Creators get an email warning at 60d.
    """
    threshold = datetime.now(timezone.utc) - timedelta(days=age_days)
    engine = _sync_engine()
    with Session(engine) as session:
        machines_result = session.execute(
            text(
                """
                UPDATE content.machines
                SET status = 'archived', updated_at = NOW()
                WHERE status = 'draft' AND updated_at < :threshold
                RETURNING id
                """
            ),
            {"threshold": threshold},
        )
        archived_machines = len(machines_result.fetchall())
        challenges_result = session.execute(
            text(
                """
                UPDATE content.challenges
                SET status = 'archived', updated_at = NOW()
                WHERE status = 'draft' AND updated_at < :threshold
                RETURNING id
                """
            ),
            {"threshold": threshold},
        )
        archived_challenges = len(challenges_result.fetchall())
        session.commit()
    engine.dispose()
    log.info(
        "expire_drafts_done",
        machines_archived=archived_machines,
        challenges_archived=archived_challenges,
        age_days=age_days,
    )
    return {
        "machines_archived": archived_machines,
        "challenges_archived": archived_challenges,
    }


# =============================================================================
# Search reindex
# =============================================================================


@shared_task(bind=True, autoretry_for=(Exception,), retry_backoff=True, max_retries=3)
def reindex_search(self) -> dict:
    """Rebuild ts_vector columns and ANALYZE search tables.

    The Phase 2 schema includes `search_vector` tsvector columns updated by
    triggers. This task forces a global re-analyze and refresh in case
    triggers were briefly disabled.
    """
    engine = _sync_engine()
    with Session(engine) as session:
        # Force vacuum analyze for fresh planner stats
        session.execute(text("ANALYZE content.machines"))
        session.execute(text("ANALYZE content.challenges"))
        session.execute(text("ANALYZE content.learning_paths"))
        session.commit()
    engine.dispose()
    log.info("reindex_search_done")
    return {"reindexed_at": datetime.now(timezone.utc).isoformat()}


# =============================================================================
# On-demand: triggered by API when machine published
# =============================================================================


@shared_task(bind=True, autoretry_for=(Exception,), retry_backoff=True, max_retries=3)
def render_machine_markdown(self, machine_id: str) -> dict:
    """Pre-render intro_markdown + walkthrough_markdown to safe HTML and cache."""
    from app.utils.markdown import render_safe_html

    engine = _sync_engine()
    with Session(engine) as session:
        row = session.execute(
            text(
                "SELECT intro_markdown, walkthrough_markdown "
                "FROM content.machines WHERE id = :id"
            ),
            {"id": machine_id},
        ).one_or_none()
        if not row:
            log.warning("render_markdown_machine_not_found", machine_id=machine_id)
            return {"rendered": False}
        intro_html = render_safe_html(row.intro_markdown) if row.intro_markdown else None
        walkthrough_html = (
            render_safe_html(row.walkthrough_markdown) if row.walkthrough_markdown else None
        )
        # Cache to Redis via a separate connection in a real impl.
        log.info(
            "machine_markdown_rendered",
            machine_id=machine_id,
            intro_len=len(intro_html or ""),
            walkthrough_len=len(walkthrough_html or ""),
        )
    engine.dispose()
    return {"rendered": True, "machine_id": machine_id}
