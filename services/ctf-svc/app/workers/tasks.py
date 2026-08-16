"""Celery tasks: lifecycle, ranking, dynamic scoring, freeze."""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

from celery import shared_task
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.logging import get_logger

log = get_logger("workers")


def _sync_engine():
    settings = get_settings()
    return create_engine(
        settings.database_sync_url,
        pool_pre_ping=True,
        pool_size=2,
        max_overflow=4,
    )


# =============================================================================
# Lifecycle transitions (status driven by timestamps)
# =============================================================================


@shared_task(bind=True, autoretry_for=(Exception,), retry_backoff=True, max_retries=3)
def transition_event_status(self) -> dict:
    """Advance events through the state machine based on current time.

    Transitions handled here:
      - published → registration when registration_starts_at passes
      - registration → live when starts_at passes
      - live → ended when ends_at passes
    """
    engine = _sync_engine()
    transitions: dict[str, int] = {
        "published_to_registration": 0,
        "registration_to_live": 0,
        "live_to_ended": 0,
    }
    with Session(engine) as session:
        # published → registration
        r1 = session.execute(
            text(
                """
                UPDATE ctf.events
                SET status = 'registration', updated_at = NOW()
                WHERE status = 'published' AND registration_starts_at <= NOW()
                RETURNING id
                """
            )
        )
        transitions["published_to_registration"] = len(r1.fetchall())

        # registration → live
        r2 = session.execute(
            text(
                """
                UPDATE ctf.events
                SET status = 'live', updated_at = NOW()
                WHERE status IN ('registration', 'published') AND starts_at <= NOW()
                RETURNING id
                """
            )
        )
        transitions["registration_to_live"] = len(r2.fetchall())

        # live → ended
        r3 = session.execute(
            text(
                """
                UPDATE ctf.events
                SET status = 'ended', updated_at = NOW()
                WHERE status = 'live' AND ends_at <= NOW()
                RETURNING id
                """
            )
        )
        transitions["live_to_ended"] = len(r3.fetchall())
        session.commit()
    engine.dispose()
    if any(transitions.values()):
        log.info("event_transitions_applied", **transitions)
    return transitions


# =============================================================================
# Ranking
# =============================================================================


@shared_task(bind=True, autoretry_for=(Exception,), retry_backoff=True, max_retries=3)
def recompute_ranks(self) -> dict:
    """Rebuild participant.rank column for all live events.

    Sorted by (points DESC, last_solve_at ASC). Disqualified participants get
    rank = NULL.
    """
    engine = _sync_engine()
    events_updated = 0
    with Session(engine) as session:
        live_event_ids = session.execute(
            text("SELECT id FROM ctf.events WHERE status = 'live'")
        ).scalars().all()
        for event_id in live_event_ids:
            # Reset disqualified ranks to NULL
            session.execute(
                text(
                    """
                    UPDATE ctf.event_participants
                    SET rank = NULL
                    WHERE event_id = :eid AND is_disqualified = TRUE
                    """
                ),
                {"eid": str(event_id)},
            )
            # Assign rank via window function
            session.execute(
                text(
                    """
                    UPDATE ctf.event_participants AS p
                    SET rank = ranked.new_rank
                    FROM (
                        SELECT
                            id,
                            ROW_NUMBER() OVER (
                                ORDER BY points DESC, last_solve_at ASC NULLS FIRST
                            ) AS new_rank
                        FROM ctf.event_participants
                        WHERE event_id = :eid AND is_disqualified = FALSE
                    ) ranked
                    WHERE p.id = ranked.id
                      AND (p.rank IS NULL OR p.rank IS DISTINCT FROM ranked.new_rank)
                    """
                ),
                {"eid": str(event_id)},
            )
            events_updated += 1
        session.commit()
    engine.dispose()
    return {"events_updated": events_updated}


# =============================================================================
# Dynamic scoring refresh
# =============================================================================


@shared_task(bind=True, autoretry_for=(Exception,), retry_backoff=True, max_retries=3)
def recompute_dynamic_scores(self) -> dict:
    """Refresh current_points for challenges in live events.

    Note: this should match the formula in app/services/scoring.py.
    We use a CTE to compute solve counts and derive current_points in a
    single SQL pass.
    """
    settings = get_settings()
    decay_factor = settings.dynamic_scoring_decay_factor
    decay_power = settings.dynamic_scoring_decay_power
    engine = _sync_engine()
    updated = 0
    with Session(engine) as session:
        # Postgres lacks a portable pow + ceil with int floor; we compute in SQL
        # using floor of base * factor^power, clamped to min_points.
        result = session.execute(
            text(
                """
                WITH solve_counts AS (
                    SELECT
                        c.id,
                        c.base_points,
                        e.min_points,
                        COALESCE(s.cnt, 0) AS cnt
                    FROM ctf.event_challenges c
                    JOIN ctf.events e ON e.id = c.event_id
                    LEFT JOIN (
                        SELECT challenge_id, COUNT(*) AS cnt
                        FROM ctf.event_solves
                        GROUP BY challenge_id
                    ) s ON s.challenge_id = c.id
                    WHERE e.status = 'live' AND e.dynamic_scoring = TRUE
                )
                UPDATE ctf.event_challenges AS c
                SET current_points = GREATEST(
                        sc.min_points,
                        CEILING(
                            sc.base_points * POWER(
                                GREATEST(0.0, 1.0 - GREATEST(sc.cnt - 1, 0) * :df),
                                :dp
                            )
                        )::INT
                    ),
                    total_solves = sc.cnt,
                    updated_at = NOW()
                FROM solve_counts sc
                WHERE c.id = sc.id
                  AND c.current_points IS DISTINCT FROM GREATEST(
                        sc.min_points,
                        CEILING(
                            sc.base_points * POWER(
                                GREATEST(0.0, 1.0 - GREATEST(sc.cnt - 1, 0) * :df),
                                :dp
                            )
                        )::INT
                  )
                """
            ),
            {"df": decay_factor, "dp": decay_power},
        )
        updated = result.rowcount or 0
        session.commit()
    engine.dispose()
    if updated:
        log.info("dynamic_scores_refreshed", challenges_updated=updated)
    return {"challenges_updated": updated}


# =============================================================================
# Freeze snapshot
# =============================================================================


@shared_task(bind=True, autoretry_for=(Exception,), retry_backoff=True, max_retries=3)
def snapshot_frozen_scoreboards(self) -> dict:
    """For each live event whose scoreboard_freeze_at has passed and that
    doesn't yet have a snapshot, write a snapshot row.
    """
    engine = _sync_engine()
    snapped = 0
    with Session(engine) as session:
        rows = session.execute(
            text(
                """
                SELECT e.id, e.scoreboard_freeze_at
                FROM ctf.events e
                LEFT JOIN ctf.frozen_scoreboards f ON f.event_id = e.id
                WHERE e.status = 'live'
                  AND e.scoreboard_freeze_at IS NOT NULL
                  AND e.scoreboard_freeze_at <= NOW()
                  AND f.event_id IS NULL
                """
            )
        ).all()
        for row in rows:
            event_id = row[0]
            frozen_at = row[1]
            # Build snapshot JSON from current participants
            session.execute(
                text(
                    """
                    INSERT INTO ctf.frozen_scoreboards (event_id, frozen_at, snapshot)
                    SELECT
                        :eid::UUID,
                        :fat,
                        COALESCE(
                            jsonb_agg(
                                jsonb_build_object(
                                    'rank', ROW_NUMBER() OVER (
                                        ORDER BY p.points DESC, p.last_solve_at ASC NULLS FIRST
                                    ),
                                    'participant_id', p.id,
                                    'participant_type', p.participant_type,
                                    'user_id', p.user_id,
                                    'team_id', p.team_id,
                                    'display_name', COALESCE(p.team_name_at_event, p.user_id::TEXT),
                                    'points', p.points,
                                    'solve_count', p.solve_count,
                                    'last_solve_at', p.last_solve_at
                                )
                                ORDER BY p.points DESC, p.last_solve_at ASC NULLS FIRST
                            ),
                            '[]'::jsonb
                        )
                    FROM ctf.event_participants p
                    WHERE p.event_id = :eid::UUID AND p.is_disqualified = FALSE
                    """
                ),
                {"eid": str(event_id), "fat": frozen_at},
            )
            snapped += 1
        session.commit()
    engine.dispose()
    if snapped:
        log.info("scoreboards_frozen", count=snapped)
    return {"scoreboards_frozen": snapped}


# =============================================================================
# Archive old events
# =============================================================================


@shared_task(bind=True, autoretry_for=(Exception,), retry_backoff=True, max_retries=3)
def archive_old_events(self, age_days: int = 30) -> dict:
    threshold = datetime.now(timezone.utc) - timedelta(days=age_days)
    engine = _sync_engine()
    with Session(engine) as session:
        result = session.execute(
            text(
                """
                UPDATE ctf.events
                SET status = 'archived', updated_at = NOW()
                WHERE status = 'ended' AND ends_at < :threshold
                RETURNING id
                """
            ),
            {"threshold": threshold},
        )
        archived = len(result.fetchall())
        session.commit()
    engine.dispose()
    log.info("events_archived", count=archived, age_days=age_days)
    return {"events_archived": archived}


# =============================================================================
# On-demand: triggered when a solve happens
# =============================================================================


@shared_task(bind=True, autoretry_for=(Exception,), retry_backoff=True, max_retries=3)
def process_solve_followups(self, event_id: str, participant_id: str) -> dict:
    """Side-effects after a solve: re-rank that single participant + log."""
    engine = _sync_engine()
    with Session(engine) as session:
        session.execute(
            text(
                """
                UPDATE ctf.event_participants AS p
                SET rank = ranked.new_rank
                FROM (
                    SELECT
                        id,
                        ROW_NUMBER() OVER (
                            ORDER BY points DESC, last_solve_at ASC NULLS FIRST
                        ) AS new_rank
                    FROM ctf.event_participants
                    WHERE event_id = :eid AND is_disqualified = FALSE
                ) ranked
                WHERE p.id = ranked.id
                """
            ),
            {"eid": event_id},
        )
        session.commit()
    engine.dispose()
    return {"event_id": event_id, "participant_id": participant_id}
