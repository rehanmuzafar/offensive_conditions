"""ctf-svc additions: announcements, hint_unlocks, frozen_scoreboards, attempts.

Phase 2 created events, event_challenges, event_participants, event_solves.
This migration adds the runtime tables ctf-svc needs.

Revision ID: 20260525_0001
Revises:
Create Date: 2026-05-25 09:00:00.000000
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260525_0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Announcements
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS ctf.event_announcements (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            event_id    UUID NOT NULL REFERENCES ctf.events(id) ON DELETE CASCADE,
            posted_by   UUID NOT NULL,
            title       TEXT NOT NULL,
            body        TEXT NOT NULL,
            is_pinned   BOOLEAN NOT NULL DEFAULT FALSE,
            challenge_id UUID REFERENCES ctf.event_challenges(id) ON DELETE SET NULL,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_announcements_event_pinned_time "
        "ON ctf.event_announcements (event_id, is_pinned DESC, created_at DESC)"
    )

    # Hint unlocks
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS ctf.hint_unlocks (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            event_id        UUID NOT NULL REFERENCES ctf.events(id) ON DELETE CASCADE,
            challenge_id    UUID NOT NULL REFERENCES ctf.event_challenges(id) ON DELETE CASCADE,
            participant_id  UUID NOT NULL REFERENCES ctf.event_participants(id) ON DELETE CASCADE,
            hint_id         TEXT NOT NULL,
            point_deduction INT NOT NULL DEFAULT 0,
            unlocked_by_user_id UUID NOT NULL,
            unlocked_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_hint_unlock UNIQUE (event_id, challenge_id, participant_id, hint_id)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_hint_unlocks_participant "
        "ON ctf.hint_unlocks (participant_id, challenge_id)"
    )

    # Frozen scoreboards
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS ctf.frozen_scoreboards (
            event_id    UUID PRIMARY KEY REFERENCES ctf.events(id) ON DELETE CASCADE,
            frozen_at   TIMESTAMPTZ NOT NULL,
            snapshot    JSONB NOT NULL DEFAULT '[]'::JSONB
        )
        """
    )

    # Flag submission attempts (for rate limiting + audit)
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS ctf.flag_submission_attempts (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            event_id        UUID NOT NULL REFERENCES ctf.events(id) ON DELETE CASCADE,
            challenge_id    UUID NOT NULL REFERENCES ctf.event_challenges(id) ON DELETE CASCADE,
            participant_id  UUID NOT NULL REFERENCES ctf.event_participants(id) ON DELETE CASCADE,
            user_id         UUID NOT NULL,
            accepted        BOOLEAN NOT NULL DEFAULT FALSE,
            submitted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_submission_attempts_window "
        "ON ctf.flag_submission_attempts (participant_id, challenge_id, submitted_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_submission_attempts_event "
        "ON ctf.flag_submission_attempts (event_id, submitted_at DESC)"
    )

    # Composite index for leaderboard queries
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_participants_event_rank "
        "ON ctf.event_participants (event_id, points DESC, last_solve_at ASC NULLS FIRST) "
        "WHERE is_disqualified = FALSE"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS ctf.flag_submission_attempts CASCADE")
    op.execute("DROP TABLE IF EXISTS ctf.frozen_scoreboards CASCADE")
    op.execute("DROP TABLE IF EXISTS ctf.hint_unlocks CASCADE")
    op.execute("DROP TABLE IF EXISTS ctf.event_announcements CASCADE")
    op.execute("DROP INDEX IF EXISTS ctf.idx_participants_event_rank")
