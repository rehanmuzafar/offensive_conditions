"""Per-team challenge progress and assignment.

A team needs to see who picked up what and how it is going, otherwise five
people work the same challenge in parallel. Rows are keyed by participant, so
on a team event the whole team shares one view and on a solo event it is just
that player's own notes.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, ErrorCode
from app.core.logging import get_logger
from app.models import ChallengeProgress, EventChallenge

log = get_logger("progress")

STATUSES = ("untouched", "in_progress", "need_help", "done")


class ProgressService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list_for_participant(
        self, event_id: UUID, *, participant_id: UUID
    ) -> list[ChallengeProgress]:
        rows = await self.session.execute(
            select(ChallengeProgress).where(
                and_(
                    ChallengeProgress.event_id == event_id,
                    ChallengeProgress.participant_id == participant_id,
                )
            )
        )
        return list(rows.scalars().all())

    async def set_progress(
        self,
        event_id: UUID,
        challenge_id: UUID,
        *,
        participant_id: UUID,
        actor_id: UUID,
        status: str | None = None,
        note: str | None = None,
        assign_to: UUID | None = None,
        unassign: bool = False,
    ) -> ChallengeProgress:
        if status is not None and status not in STATUSES:
            raise AppError(
                ErrorCode.VALIDATION, f"status must be one of {', '.join(STATUSES)}"
            )

        # The challenge has to belong to this event — otherwise a team could
        # write progress rows against another event's challenges.
        owns = await self.session.execute(
            select(EventChallenge.id).where(
                and_(
                    EventChallenge.id == challenge_id,
                    EventChallenge.event_id == event_id,
                )
            )
        )
        if owns.scalar_one_or_none() is None:
            raise AppError(ErrorCode.CHALLENGE_NOT_FOUND, "challenge not found in this event")

        existing = await self.session.execute(
            select(ChallengeProgress).where(
                and_(
                    ChallengeProgress.challenge_id == challenge_id,
                    ChallengeProgress.participant_id == participant_id,
                )
            )
        )
        row = existing.scalar_one_or_none()
        if row is None:
            row = ChallengeProgress(
                event_id=event_id,
                challenge_id=challenge_id,
                participant_id=participant_id,
                status="untouched",
            )
            self.session.add(row)

        if status is not None:
            row.status = status
        if note is not None:
            row.note = note or None

        if unassign:
            row.assigned_to_user_id = None
            row.assigned_by_user_id = None
            row.assigned_at = None
        elif assign_to is not None:
            row.assigned_to_user_id = assign_to
            row.assigned_by_user_id = actor_id
            row.assigned_at = datetime.now(timezone.utc)
            # Claiming a challenge implies work has started, unless the caller
            # said otherwise in the same request.
            if status is None and row.status == "untouched":
                row.status = "in_progress"

        row.updated_by_user_id = actor_id
        await self.session.flush()
        await self.session.refresh(row)

        log.info(
            "challenge_progress_set",
            event_id=str(event_id),
            challenge_id=str(challenge_id),
            participant_id=str(participant_id),
            status=row.status,
            assigned_to=str(row.assigned_to_user_id) if row.assigned_to_user_id else None,
        )
        return row
