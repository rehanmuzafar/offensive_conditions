"""Event-wide solve feed.

The scoreboard answers "who is winning"; this answers "what just happened".
Both read the same solves, but this one is ordered by time and stays cheap
enough to poll, so it is a separate query rather than a shaped scoreboard.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


@dataclass(slots=True)
class ActivityItem:
    solved_at: datetime
    challenge_id: UUID
    challenge_name: str
    category: str
    is_first_blood: bool
    # Solo participants have no team, so the actor falls back to the player.
    team_id: UUID | None
    actor: str


# team_name_at_event is captured at registration, so a later rename does not
# rewrite history in the feed.
_FEED_SQL = text(
    """
    SELECT s.solved_at,
           s.is_first_blood,
           s.challenge_id,
           c.name      AS challenge_name,
           c.category  AS category,
           p.team_id   AS team_id,
           COALESCE(NULLIF(p.team_name_at_event, ''), '') AS team_name
      FROM ctf.event_solves s
      JOIN ctf.event_challenges c ON c.id = s.challenge_id
      LEFT JOIN ctf.event_participants p ON p.id = s.participant_id
     WHERE s.event_id = :event_id
     ORDER BY s.solved_at DESC
     LIMIT :limit
    """
)


class ActivityService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def feed(self, event_id: UUID, limit: int = 50) -> list[ActivityItem]:
        rows = (
            await self.session.execute(_FEED_SQL, {"event_id": event_id, "limit": limit})
        ).all()
        return [
            ActivityItem(
                solved_at=r.solved_at,
                challenge_id=r.challenge_id,
                challenge_name=r.challenge_name,
                category=r.category,
                is_first_blood=r.is_first_blood,
                team_id=r.team_id,
                # A blank name means a solo entry; the caller renders "a player"
                # rather than inventing one.
                actor=r.team_name or "",
            )
            for r in rows
        ]
