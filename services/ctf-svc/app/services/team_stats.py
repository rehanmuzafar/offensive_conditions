"""Per-team CTF statistics.

The numbers already exist: `ctf.event_participants` carries one row per player
per event with `points`, `solve_count` and `last_solve_at`. A team's stats are
therefore an aggregation over that table, not a new thing to track.

Teams themselves live in user-svc, so this service deliberately returns raw
`user_id`s and lets the caller join them against the roster it already has.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


@dataclass(slots=True)
class MemberStats:
    user_id: UUID
    points: int
    flags: int
    events_played: int
    first_bloods: int
    last_solve_at: datetime | None


@dataclass(slots=True)
class UserStats:
    user_id: UUID
    points: int
    flags: int
    events_played: int
    first_bloods: int
    best_rank: int | None
    teams_played_with: int
    last_solve_at: datetime | None


@dataclass(slots=True)
class TeamTotals:
    """A team's headline numbers, without the per-member breakdown.

    What a list needs and no more: the members are the expensive half of the
    per-team query and nothing in a list renders them.
    """

    team_id: UUID
    points: int
    flags: int
    events_played: int


@dataclass(slots=True)
class TeamStats:
    team_id: UUID
    points: int
    flags: int
    events_played: int
    first_bloods: int
    best_rank: int | None
    last_solve_at: datetime | None
    members: list[MemberStats]


# Solves are attributed to a player inside a team; first bloods live on the
# solve rows themselves, so they are counted separately and joined back in.
_MEMBER_SQL = text(
    """
    SELECT p.user_id,
           COALESCE(SUM(p.points), 0)::BIGINT      AS points,
           COALESCE(SUM(p.solve_count), 0)::BIGINT AS flags,
           COUNT(DISTINCT p.event_id)::BIGINT      AS events_played,
           MAX(p.last_solve_at)                    AS last_solve_at,
           COALESCE(fb.first_bloods, 0)::BIGINT    AS first_bloods
      FROM ctf.event_participants p
      LEFT JOIN (
            SELECT s.solving_user_id AS user_id, COUNT(*) AS first_bloods
              FROM ctf.event_solves s
              JOIN ctf.event_participants sp ON sp.id = s.participant_id
             WHERE sp.team_id = :team_id
               AND s.is_first_blood
             GROUP BY s.solving_user_id
      ) fb ON fb.user_id = p.user_id
     WHERE p.team_id = :team_id
       AND p.user_id IS NOT NULL
       AND NOT p.is_disqualified
     GROUP BY p.user_id, fb.first_bloods
     ORDER BY points DESC, flags DESC
    """
)

# Totals for many teams at once. The per-team query above sums over members,
# which is right for one team and wrong for a list: rendering twenty-four teams
# would mean twenty-four round trips, each doing its own member breakdown that
# the list never shows. This aggregates straight to the team.
_BULK_SQL = text(
    """
    SELECT p.team_id,
           COALESCE(SUM(p.points), 0)::BIGINT      AS points,
           COALESCE(SUM(p.solve_count), 0)::BIGINT AS flags,
           COUNT(DISTINCT p.event_id)::BIGINT      AS events_played
      FROM ctf.event_participants p
     WHERE p.team_id = ANY(:team_ids)
       AND NOT p.is_disqualified
     GROUP BY p.team_id
    """
)

# A team's rank is per event, so "best" is the lowest rank it ever placed.
_BEST_RANK_SQL = text(
    """
    SELECT MIN(rank) FROM ctf.event_participants
     WHERE team_id = :team_id AND rank IS NOT NULL AND NOT is_disqualified
    """
)


class TeamStatsService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def totals_for(self, team_ids: list[UUID]) -> dict[UUID, TeamTotals]:
        """Points, flags and events for each of `team_ids`, in one query.

        Teams that have never entered an event are absent from the result rather
        than present as zeros — the caller knows which ids it asked for, and a
        missing row is cheaper to default than to fabricate here.
        """
        if not team_ids:
            return {}
        rows = (await self.session.execute(_BULK_SQL, {"team_ids": team_ids})).all()
        return {
            r.team_id: TeamTotals(
                team_id=r.team_id,
                points=int(r.points),
                flags=int(r.flags),
                events_played=int(r.events_played),
            )
            for r in rows
        }

    async def for_team(self, team_id: UUID) -> TeamStats:
        rows = (await self.session.execute(_MEMBER_SQL, {"team_id": team_id})).all()
        members = [
            MemberStats(
                user_id=r.user_id,
                points=int(r.points),
                flags=int(r.flags),
                events_played=int(r.events_played),
                first_bloods=int(r.first_bloods),
                last_solve_at=r.last_solve_at,
            )
            for r in rows
        ]
        best_rank = (
            await self.session.execute(_BEST_RANK_SQL, {"team_id": team_id})
        ).scalar_one_or_none()

        # Events played by the team is not the sum over members — several
        # players enter the same event — so it is counted across the roster.
        event_ids = await self.session.execute(
            text(
                "SELECT COUNT(DISTINCT event_id) FROM ctf.event_participants"
                " WHERE team_id = :team_id AND NOT is_disqualified"
            ),
            {"team_id": team_id},
        )
        last_solves = [m.last_solve_at for m in members if m.last_solve_at]

        return TeamStats(
            team_id=team_id,
            points=sum(m.points for m in members),
            flags=sum(m.flags for m in members),
            events_played=int(event_ids.scalar_one() or 0),
            first_bloods=sum(m.first_bloods for m in members),
            best_rank=int(best_rank) if best_rank is not None else None,
            last_solve_at=max(last_solves) if last_solves else None,
            members=members,
        )


# A player's career totals: every event they entered, whether solo or with a
# team. Solo rows carry a NULL team_id, so team counting must ignore those.
_USER_SQL = text(
    """
    SELECT COALESCE(SUM(p.points), 0)::BIGINT           AS points,
           COALESCE(SUM(p.solve_count), 0)::BIGINT      AS flags,
           COUNT(DISTINCT p.event_id)::BIGINT           AS events_played,
           COUNT(DISTINCT p.team_id)::BIGINT            AS teams_played_with,
           MIN(p.rank)                                  AS best_rank,
           MAX(p.last_solve_at)                         AS last_solve_at
      FROM ctf.event_participants p
     WHERE p.user_id = :user_id
       AND NOT p.is_disqualified
    """
)

_USER_FIRST_BLOODS_SQL = text(
    "SELECT COUNT(*) FROM ctf.event_solves WHERE solving_user_id = :user_id AND is_first_blood"
)


async def user_stats(session: AsyncSession, user_id: UUID) -> UserStats:
    row = (await session.execute(_USER_SQL, {"user_id": user_id})).one()
    first_bloods = (
        await session.execute(_USER_FIRST_BLOODS_SQL, {"user_id": user_id})
    ).scalar_one()
    return UserStats(
        user_id=user_id,
        points=int(row.points),
        flags=int(row.flags),
        events_played=int(row.events_played),
        teams_played_with=int(row.teams_played_with),
        first_bloods=int(first_bloods or 0),
        best_rank=int(row.best_rank) if row.best_rank is not None else None,
        last_solve_at=row.last_solve_at,
    )
