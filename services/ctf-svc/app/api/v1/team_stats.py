"""Team CTF stats — mounted at /v1/teams/... behind the /v1/ctf/ edge prefix.

The roster (names, roles, join dates) belongs to user-svc; this only returns
the CTF numbers keyed by user_id so the caller can merge the two.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_claims
from app.core.auth import Claims
from app.db.session import get_session
from app.services.team_stats import TeamStatsService, user_stats

router = APIRouter(prefix="/teams", tags=["teams"])
user_router = APIRouter(prefix="/users", tags=["users"])


class MemberStatsRead(BaseModel):
    user_id: UUID
    points: int
    flags: int
    events_played: int
    first_bloods: int
    last_solve_at: datetime | None = None


class TeamStatsRead(BaseModel):
    team_id: UUID
    points: int
    flags: int
    events_played: int
    first_bloods: int
    best_rank: int | None = None
    last_solve_at: datetime | None = None
    members: list[MemberStatsRead]


@router.get("/{team_id}/stats", response_model=TeamStatsRead)
async def team_stats(
    team_id: UUID,
    claims: Claims = Depends(get_claims),
    session: AsyncSession = Depends(get_session),
) -> TeamStatsRead:
    # Stats are public the way a scoreboard is: any signed-in player can look
    # at any team's record. Nothing here is private to the team.
    stats = await TeamStatsService(session).for_team(team_id)
    return TeamStatsRead(
        team_id=stats.team_id,
        points=stats.points,
        flags=stats.flags,
        events_played=stats.events_played,
        first_bloods=stats.first_bloods,
        best_rank=stats.best_rank,
        last_solve_at=stats.last_solve_at,
        members=[
            MemberStatsRead(
                user_id=m.user_id,
                points=m.points,
                flags=m.flags,
                events_played=m.events_played,
                first_bloods=m.first_bloods,
                last_solve_at=m.last_solve_at,
            )
            for m in stats.members
        ],
    )


class UserStatsRead(BaseModel):
    user_id: UUID
    points: int
    flags: int
    events_played: int
    first_bloods: int
    best_rank: int | None = None
    teams_played_with: int
    last_solve_at: datetime | None = None


@user_router.get("/{user_id}/ctf-stats", response_model=UserStatsRead)
async def player_stats(
    user_id: UUID,
    claims: Claims = Depends(get_claims),
    session: AsyncSession = Depends(get_session),
) -> UserStatsRead:
    # Public like a profile: any signed-in player can read anyone's CTF record.
    s = await user_stats(session, user_id)
    return UserStatsRead(
        user_id=s.user_id,
        points=s.points,
        flags=s.flags,
        events_played=s.events_played,
        first_bloods=s.first_bloods,
        best_rank=s.best_rank,
        teams_played_with=s.teams_played_with,
        last_solve_at=s.last_solve_at,
    )
