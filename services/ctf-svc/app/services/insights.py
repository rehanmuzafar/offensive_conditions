"""Scoreboard insights: the points-over-time series and the trending panel.

Both read `ctf.event_solves`, which is the only record of *when* something
happened — `event_participants` holds only the running totals.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


@dataclass(slots=True)
class SeriesPoint:
    at: datetime
    points: int


@dataclass(slots=True)
class TeamSeries:
    team_id: UUID | None
    name: str
    points: int
    points_over_time: list[SeriesPoint] = field(default_factory=list)


# Cumulative points per team over time. Restricted to the leading teams because
# the chart is unreadable past about ten lines.
_SERIES_SQL = text(
    """
    WITH points AS (
        -- Earned: a solve, less any hint the team unlocked on it.
        SELECT COALESCE(p.team_id::text, 'user:' || p.user_id::text) AS grp,
               p.team_id,
               COALESCE(NULLIF(p.team_name_at_event, ''),
                        NULLIF(p.display_name, ''), 'Unnamed')       AS name,
               s.solved_at                                           AS at,
               (s.points_at_solve - COALESCE(s.point_deduction, 0))  AS pts
          FROM ctf.event_solves s
          JOIN ctf.event_participants p ON p.id = s.participant_id
         WHERE s.event_id = :event_id AND NOT p.is_disqualified

        UNION ALL

        -- Awarded or deducted by an organiser, plotted at the moment it was
        -- applied. Without this the chart and the board disagree: a team could
        -- lose 500 points to a penalty and the line would not move.
        --
        -- The name is resolved with a scalar subquery rather than a join. A
        -- team has one participant row per member, so joining would repeat the
        -- adjustment once per member and multiply a +50 into +150.
        SELECT COALESCE(a.team_id::text, 'user:' || a.user_id::text) AS grp,
               a.team_id,
               (SELECT COALESCE(NULLIF(p.team_name_at_event, ''),
                                NULLIF(p.display_name, ''), 'Unnamed')
                  FROM ctf.event_participants p
                 WHERE p.event_id = a.event_id
                   AND ((a.team_id IS NOT NULL AND p.team_id = a.team_id)
                     OR (a.user_id IS NOT NULL AND p.user_id = a.user_id))
                 LIMIT 1)                                            AS name,
               a.created_at                                          AS at,
               a.delta                                               AS pts
          FROM ctf.score_adjustments a
         WHERE a.event_id = :event_id
           AND EXISTS (
                 SELECT 1 FROM ctf.event_participants p
                  WHERE p.event_id = a.event_id
                    AND ((a.team_id IS NOT NULL AND p.team_id = a.team_id)
                      OR (a.user_id IS NOT NULL AND p.user_id = a.user_id))
                    AND NOT p.is_disqualified
               )
    ),
    totals AS (
        SELECT grp, MAX(team_id::text) AS team_id, MAX(name) AS name,
               SUM(pts)::BIGINT AS total
          FROM points GROUP BY grp
         ORDER BY total DESC
         LIMIT :top
    )
    SELECT t.grp, t.team_id, t.name, t.total,
           s.at AS solved_at,
           SUM(s.pts) OVER (PARTITION BY s.grp ORDER BY s.at
                            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)::BIGINT AS running
      FROM totals t
      JOIN points s ON s.grp = t.grp
     ORDER BY t.total DESC, s.at ASC
    """
)


@dataclass(slots=True)
class TrendingStats:
    total_teams: int
    total_players: int
    mvp_name: str | None
    mvp_team: str | None
    mvp_points: int
    popular_challenge: str | None
    popular_category: str | None
    popular_solves: int
    valuable_challenge: str | None
    valuable_category: str | None
    valuable_points: int
    # difficulty -> (solved_by, total_participants) so the bar can show a share
    solves_by_difficulty: list[tuple[str, int, int]]


class InsightsService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def series(self, event_id: UUID, top: int = 10) -> list[TeamSeries]:
        rows = (
            await self.session.execute(_SERIES_SQL, {"event_id": event_id, "top": top})
        ).all()
        out: dict[str, TeamSeries] = {}
        for r in rows:
            s = out.get(r.grp)
            if s is None:
                s = TeamSeries(
                    team_id=UUID(r.team_id) if r.team_id else None,
                    name=r.name,
                    points=int(r.total),
                )
                out[r.grp] = s
            s.points_over_time.append(SeriesPoint(at=r.solved_at, points=int(r.running)))
        return list(out.values())

    async def trending(self, event_id: UUID) -> TrendingStats:
        totals = (
            await self.session.execute(
                text(
                    """
                    SELECT COUNT(DISTINCT team_id) FILTER (WHERE team_id IS NOT NULL) AS teams,
                           COUNT(DISTINCT user_id)                                    AS players
                      FROM ctf.event_participants
                     WHERE event_id = :e AND NOT is_disqualified
                    """
                ),
                {"e": event_id},
            )
        ).one()

        # Most valuable player is the individual with the most points, which is
        # not the same as being on the leading team.
        mvp = (
            await self.session.execute(
                text(
                    """
                    SELECT COALESCE(NULLIF(p.display_name, ''), 'player') AS name,
                           NULLIF(p.team_name_at_event, '')               AS team,
                           p.points
                      FROM ctf.event_participants p
                     WHERE p.event_id = :e AND NOT p.is_disqualified
                     ORDER BY p.points DESC NULLS LAST
                     LIMIT 1
                    """
                ),
                {"e": event_id},
            )
        ).one_or_none()

        popular = (
            await self.session.execute(
                text(
                    """
                    SELECT name, category, total_solves
                      FROM ctf.event_challenges
                     WHERE event_id = :e AND NOT is_hidden
                     ORDER BY total_solves DESC NULLS LAST
                     LIMIT 1
                    """
                ),
                {"e": event_id},
            )
        ).one_or_none()

        valuable = (
            await self.session.execute(
                text(
                    """
                    SELECT name, category, base_points
                      FROM ctf.event_challenges
                     WHERE event_id = :e AND NOT is_hidden
                     ORDER BY base_points DESC NULLS LAST
                     LIMIT 1
                    """
                ),
                {"e": event_id},
            )
        ).one_or_none()

        # Per difficulty: how many of its challenges have been solved at least
        # once, out of how many exist. A share, not a raw count.
        diff = (
            await self.session.execute(
                text(
                    """
                    SELECT difficulty,
                           COUNT(*) FILTER (WHERE total_solves > 0)::INT AS solved,
                           COUNT(*)::INT                                 AS total
                      FROM ctf.event_challenges
                     WHERE event_id = :e AND NOT is_hidden
                     GROUP BY difficulty
                     ORDER BY MIN(base_points)
                    """
                ),
                {"e": event_id},
            )
        ).all()

        return TrendingStats(
            total_teams=int(totals.teams or 0),
            total_players=int(totals.players or 0),
            mvp_name=mvp.name if mvp else None,
            mvp_team=mvp.team if mvp else None,
            mvp_points=int(mvp.points) if mvp else 0,
            popular_challenge=popular.name if popular else None,
            popular_category=popular.category if popular else None,
            popular_solves=int(popular.total_solves or 0) if popular else 0,
            valuable_challenge=valuable.name if valuable else None,
            valuable_category=valuable.category if valuable else None,
            valuable_points=int(valuable.base_points or 0) if valuable else 0,
            solves_by_difficulty=[(d.difficulty, d.solved, d.total) for d in diff],
        )
