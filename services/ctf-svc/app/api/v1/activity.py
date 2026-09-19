"""Global activity feed for an event."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_claims
from app.core.auth import Claims
from app.db.session import get_session
from app.services.activity import ActivityService
from app.services.events import EventService

router = APIRouter(prefix="/events/{event_id}/activity", tags=["activity"])


class ActivityRead(BaseModel):
    solved_at: datetime
    challenge_id: UUID
    challenge_name: str
    category: str
    is_first_blood: bool
    team_id: UUID | None = None
    actor: str


@router.get("", response_model=list[ActivityRead])
async def activity_feed(
    event_id: UUID,
    limit: int = Query(default=50, ge=1, le=200),
    claims: Claims = Depends(get_claims),
    session: AsyncSession = Depends(get_session),
) -> list[ActivityRead]:
    """Recent solves across the whole event, newest first.

    Subject to the same two rules as the scoreboard, because it carries the same
    information ordered by time — plus challenge ids, which the scoreboard does
    not expose at all:

      * the organiser's scoreboard_visibility choice (public / participants /
        hidden) is enforced, so a hidden board does not leak through here; and
      * the freeze window is applied, so the final hour stays dark for players.

    Before this both were missing. Any signed-in account could read the feed for
    any event, which defeated the freeze outright and handed out the challenge
    ids used to read challenge content without registering.
    """
    events = EventService(session)
    is_organizer = claims.is_ctf_organizer
    await events.assert_scoreboard_visible(
        event_id, viewer_user_id=claims.user_id, viewer_is_organizer=is_organizer
    )

    cutoff = None
    if not is_organizer:
        event = await events.get(event_id)
        freeze_at = getattr(event, "scoreboard_freeze_at", None)
        if freeze_at is not None and freeze_at <= datetime.now(timezone.utc):
            cutoff = freeze_at

    items = await ActivityService(session).feed(event_id, limit, cutoff=cutoff)
    return [
        ActivityRead(
            solved_at=i.solved_at,
            challenge_id=i.challenge_id,
            challenge_name=i.challenge_name,
            category=i.category,
            is_first_blood=i.is_first_blood,
            team_id=i.team_id,
            actor=i.actor,
        )
        for i in items
    ]
