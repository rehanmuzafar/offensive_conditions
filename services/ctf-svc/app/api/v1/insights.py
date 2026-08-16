"""Scoreboard extras: the points-over-time chart and the trending panel."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_claims
from app.core.auth import Claims
from app.db.session import get_session
from app.services.insights import InsightsService

router = APIRouter(prefix="/events/{event_id}", tags=["insights"])


class SeriesPointRead(BaseModel):
    at: datetime
    points: int


class TeamSeriesRead(BaseModel):
    team_id: UUID | None = None
    name: str
    points: int
    points_over_time: list[SeriesPointRead]


class DifficultyBucket(BaseModel):
    difficulty: str
    solved: int
    total: int


class TrendingRead(BaseModel):
    total_teams: int
    total_players: int
    mvp_name: str | None = None
    mvp_team: str | None = None
    mvp_points: int
    popular_challenge: str | None = None
    popular_category: str | None = None
    popular_solves: int
    valuable_challenge: str | None = None
    valuable_category: str | None = None
    valuable_points: int
    solves_by_difficulty: list[DifficultyBucket]


@router.get("/series", response_model=list[TeamSeriesRead])
async def points_over_time(
    event_id: UUID,
    top: int = Query(default=10, ge=1, le=25),
    claims: Claims = Depends(get_claims),
    session: AsyncSession = Depends(get_session),
) -> list[TeamSeriesRead]:
    """Cumulative points per team over time, for the scoreboard chart."""
    series = await InsightsService(session).series(event_id, top)
    return [
        TeamSeriesRead(
            team_id=s.team_id,
            name=s.name,
            points=s.points,
            points_over_time=[SeriesPointRead(at=p.at, points=p.points) for p in s.points_over_time],
        )
        for s in series
    ]


@router.get("/trending", response_model=TrendingRead)
async def trending(
    event_id: UUID,
    claims: Claims = Depends(get_claims),
    session: AsyncSession = Depends(get_session),
) -> TrendingRead:
    """Headline numbers for the scoreboard's second panel."""
    t = await InsightsService(session).trending(event_id)
    return TrendingRead(
        total_teams=t.total_teams,
        total_players=t.total_players,
        mvp_name=t.mvp_name,
        mvp_team=t.mvp_team,
        mvp_points=t.mvp_points,
        popular_challenge=t.popular_challenge,
        popular_category=t.popular_category,
        popular_solves=t.popular_solves,
        valuable_challenge=t.valuable_challenge,
        valuable_category=t.valuable_category,
        valuable_points=t.valuable_points,
        solves_by_difficulty=[
            DifficultyBucket(difficulty=d, solved=s, total=tot)
            for d, s, tot in t.solves_by_difficulty
        ],
    )
