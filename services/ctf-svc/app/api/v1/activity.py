"""Global activity feed for an event."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_claims
from app.core.auth import Claims
from app.db.session import get_session
from app.services.activity import ActivityService

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

    Public to any signed-in player, like the scoreboard — it reveals only what
    the scoreboard already does, just ordered by time.
    """
    items = await ActivityService(session).feed(event_id, limit)
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
