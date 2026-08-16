"""Event service: CRUD, lifecycle, leaderboard."""

from __future__ import annotations

import csv
import io
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import and_, func, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, ErrorCode
from app.core.logging import get_logger
from app.models import Event, EventParticipant, FrozenScoreboard
from app.schemas import EventCreate, EventUpdate, LeaderboardEntry

log = get_logger("events")


_ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "draft": {"published", "archived"},
    "published": {"registration", "draft", "archived"},
    "registration": {"live", "published", "archived"},
    "live": {"ended"},
    "ended": {"archived"},
    "archived": set(),
}


class EventService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # =========================================================================
    # Read
    # =========================================================================

    async def get(self, event_id: UUID) -> Event:
        result = await self.session.execute(select(Event).where(Event.id == event_id))
        event = result.scalar_one_or_none()
        if not event:
            raise AppError(ErrorCode.EVENT_NOT_FOUND, "event not found")
        return event

    async def get_by_slug(self, slug: str) -> Event:
        result = await self.session.execute(
            select(Event).where(func.lower(Event.slug) == slug.lower())
        )
        event = result.scalar_one_or_none()
        if not event:
            raise AppError(ErrorCode.EVENT_NOT_FOUND, "event not found")
        return event

    async def list_(
        self,
        *,
        viewer_tier: str = "free",
        status: str | None = None,
        format_: str | None = None,
        visibility: str | None = None,
        viewer_is_organizer: bool = False,
        limit: int = 25,
        offset: int = 0,
    ) -> tuple[list[Event], int]:
        stmt = select(Event).order_by(Event.starts_at.desc())
        count_stmt = select(func.count()).select_from(Event)

        # Hide drafts + archived from non-organizers
        if not viewer_is_organizer:
            stmt = stmt.where(Event.status.in_(["published", "registration", "live", "ended"]))
            count_stmt = count_stmt.where(
                Event.status.in_(["published", "registration", "live", "ended"])
            )
            # Public events only (private events not listed)
            stmt = stmt.where(Event.visibility != "invite_only")
            count_stmt = count_stmt.where(Event.visibility != "invite_only")

        # Tier gating
        if viewer_tier == "free":
            stmt = stmt.where(Event.required_tier == "free")
            count_stmt = count_stmt.where(Event.required_tier == "free")
        elif viewer_tier == "vip":
            stmt = stmt.where(Event.required_tier.in_(["free", "vip"]))
            count_stmt = count_stmt.where(Event.required_tier.in_(["free", "vip"]))

        if status:
            stmt = stmt.where(Event.status == status)
            count_stmt = count_stmt.where(Event.status == status)
        if format_:
            stmt = stmt.where(Event.format == format_)
            count_stmt = count_stmt.where(Event.format == format_)
        if visibility:
            stmt = stmt.where(Event.visibility == visibility)
            count_stmt = count_stmt.where(Event.visibility == visibility)

        total = (await self.session.execute(count_stmt)).scalar_one()
        result = await self.session.execute(stmt.limit(limit).offset(offset))
        return list(result.scalars().all()), int(total)

    # =========================================================================
    # Write
    # =========================================================================

    async def create(self, *, creator_id: UUID, data: EventCreate) -> Event:
        body = data.model_dump()
        body["prize_pool"] = [
            p if isinstance(p, dict) else p.model_dump() for p in body.get("prize_pool", [])
        ]
        # Auto-set scoreboard_freeze if not given (60 min before end)
        if not body.get("scoreboard_freeze_at"):
            from datetime import timedelta
            body["scoreboard_freeze_at"] = body["ends_at"] - timedelta(minutes=60)

        event = Event(created_by=creator_id, **body)
        self.session.add(event)
        try:
            await self.session.flush()
        except IntegrityError as e:
            await self.session.rollback()
            if "slug" in str(e.orig).lower():
                raise AppError(ErrorCode.CONFLICT, "slug already in use")
            raise
        # See the note in update(): the column_property needs an explicit
        # refresh before this row is serialised.
        await self.session.refresh(event)

        log.info("event_created", event_id=str(event.id), creator=str(creator_id))
        return event

    async def update(
        self, event_id: UUID, *, actor_id: UUID, is_organizer: bool, data: EventUpdate
    ) -> Event:
        event = await self.get(event_id)
        if not is_organizer and event.created_by != actor_id:
            raise AppError(ErrorCode.NOT_ORGANIZER, "only the organizer can edit")

        body = data.model_dump(exclude_unset=True)
        if "prize_pool" in body and body["prize_pool"] is not None:
            body["prize_pool"] = [
                p if isinstance(p, dict) else p.model_dump() for p in body["prize_pool"]
            ]

        # Organisers keep tuning a running event — description, rules, banner,
        # scoreboard visibility. Only the schedule is off-limits once it starts,
        # since moving the clock under people mid-CTF is not a fix, and an ended
        # event is frozen entirely.
        if event.status in ("ended", "archived"):
            raise AppError(
                ErrorCode.FORBIDDEN, "this event has ended and can no longer be edited"
            )
        if event.status in ("live",):
            frozen = {"starts_at", "registration_starts_at", "registration_ends_at"}
            blocked = frozen & set(body)
            if blocked:
                raise AppError(
                    ErrorCode.FORBIDDEN,
                    f"cannot change {sorted(blocked)} while the event is running",
                )

        for k, v in body.items():
            setattr(event, k, v)
        try:
            await self.session.flush()
        except IntegrityError as e:
            await self.session.rollback()
            # chk_ctf_timing enforces
            #   registration_starts_at < registration_ends_at <= starts_at < ends_at
            # Surfacing it as a 500 told the organiser nothing about what to fix.
            if "chk_ctf_timing" in str(e.orig):
                raise AppError(
                    ErrorCode.VALIDATION,
                    "invalid schedule: registration must open before it closes, close at "
                    "or before the start, and the event must start before it ends",
                ) from e
            raise
        # challenge_count is a column_property (a correlated subquery), so it is
        # not part of the INSERT/UPDATE and is left unloaded after a flush.
        # Serialising the row would then trigger lazy IO — MissingGreenlet
        # under asyncio. Refresh while the async context is still open.
        await self.session.refresh(event)
        return event

    # =========================================================================
    # Lifecycle
    # =========================================================================

    async def delete(self, event_id: UUID, *, actor_id: UUID) -> None:
        """Remove an event. Foreign keys cascade to its children."""
        event = await self.get(event_id)
        await self.session.delete(event)
        await self.session.flush()
        log.info("event_deleted", event_id=str(event_id), actor=str(actor_id),
                 slug=event.slug)

    async def transition_status(
        self,
        event_id: UUID,
        *,
        new_status: str,
        actor_id: UUID,
        is_organizer: bool,
    ) -> Event:
        event = await self.get(event_id)
        if not is_organizer and event.created_by != actor_id:
            raise AppError(ErrorCode.NOT_ORGANIZER, "only the organizer can change status")

        allowed = _ALLOWED_TRANSITIONS.get(event.status, set())
        if new_status not in allowed:
            raise AppError(
                ErrorCode.INVALID_STATUS_TRANSITION,
                f"cannot transition from {event.status} to {new_status}",
            )

        event.status = new_status
        await self.session.flush()
        # challenge_count is a column_property (a correlated subquery), so it is
        # not part of the INSERT/UPDATE and is left unloaded after a flush.
        # Serialising the row would then trigger lazy IO — MissingGreenlet
        # under asyncio. Refresh while the async context is still open.
        await self.session.refresh(event)
        log.info(
            "event_status_changed",
            event_id=str(event_id),
            new_status=new_status,
            actor=str(actor_id),
        )
        return event

    # =========================================================================
    # Leaderboard
    # =========================================================================

    async def assert_scoreboard_visible(
        self,
        event_id: UUID,
        *,
        viewer_user_id: UUID | None,
        viewer_is_organizer: bool,
    ) -> None:
        """Enforce the organiser's scoreboard_visibility choice.

        public       — anyone, signed in or not
        participants — only players registered for this event
        hidden       — organisers only
        """
        if viewer_is_organizer:
            return

        event = await self.get(event_id)
        mode = getattr(event, "scoreboard_visibility", "public")
        if mode == "public":
            return
        if mode == "hidden":
            raise AppError(
                ErrorCode.FORBIDDEN, "the organiser has hidden this scoreboard"
            )

        # participants-only
        if viewer_user_id is None:
            raise AppError(
                ErrorCode.NOT_REGISTERED,
                "this scoreboard is visible to registered players only",
            )
        found = await self.session.execute(
            select(EventParticipant.id).where(
                EventParticipant.event_id == event_id,
                EventParticipant.user_id == viewer_user_id,
            )
        )
        if found.scalar_one_or_none() is None:
            raise AppError(
                ErrorCode.NOT_REGISTERED,
                "this scoreboard is visible to registered players only",
            )

    async def get_leaderboard(
        self,
        event_id: UUID,
        *,
        viewer_is_organizer: bool,
        limit: int = 100,
    ) -> tuple[list[LeaderboardEntry], bool]:
        """Returns (entries, is_frozen).

        Public viewers see frozen snapshot once freeze time passes.
        Organizers always see live data.
        """
        event = await self.get(event_id)
        now = datetime.now(timezone.utc)

        is_freeze_active = (
            event.scoreboard_freeze_at is not None
            and event.scoreboard_freeze_at <= now
            and event.status == "live"
        )
        show_frozen = is_freeze_active and not viewer_is_organizer

        if show_frozen:
            # Read snapshot
            snap = await self.session.execute(
                select(FrozenScoreboard).where(FrozenScoreboard.event_id == event_id)
            )
            frozen = snap.scalar_one_or_none()
            if frozen and frozen.snapshot:
                entries = [LeaderboardEntry(**e) for e in frozen.snapshot[:limit]]
                return entries, True
            # No snapshot yet (race); fall through to live and label not frozen

        # Live leaderboard.
        #
        # Registration is per player, so a team has one participant row per
        # member. Ranking those rows directly makes a team compete against
        # itself, so team rows are summed into one entry per team; solo rows
        # (team_id IS NULL) stay per player.
        rows = (
            await self.session.execute(
                text(
                    """
                    SELECT COALESCE(p.team_id::text, 'user:' || p.user_id::text) AS grp,
                           -- Postgres has no min(uuid); aggregate as text.
                           MIN(p.id::text)                            AS participant_id,
                           CASE WHEN p.team_id IS NULL THEN MIN(p.user_id::text) END AS user_id,
                           p.team_id                                  AS team_id,
                           MAX(COALESCE(NULLIF(p.team_name_at_event, ''), '')) AS team_name,
                           MAX(COALESCE(NULLIF(p.display_name, ''), ''))     AS display_name,
                           -- users.teams is another service's schema, but it is
                           -- the same database and the alternative is one
                           -- lookup per row on the most-read page in the app.
                           MAX(COALESCE(t.country_code, ''))          AS country_code,
                           SUM(p.points)::BIGINT                      AS points,
                           SUM(p.solve_count)::BIGINT                 AS solve_count,
                           MAX(p.last_solve_at)                       AS last_solve_at,
                           COALESCE(SUM(sv.fb), 0)::INT              AS first_bloods
                      FROM ctf.event_participants p
                      LEFT JOIN users.teams t ON t.id = p.team_id
                      LEFT JOIN (
                            SELECT participant_id, COUNT(*)::INT AS fb
                              FROM ctf.event_solves
                             WHERE is_first_blood
                             GROUP BY participant_id
                      ) sv ON sv.participant_id = p.id
                     WHERE p.event_id = :event_id
                       AND NOT p.is_disqualified
                     GROUP BY grp, p.team_id
                     ORDER BY points DESC, last_solve_at ASC NULLS FIRST
                     LIMIT :limit
                    """
                ),
                {"event_id": event_id, "limit": limit},
            )
        ).all()

        entries: list[LeaderboardEntry] = []
        for i, r in enumerate(rows, start=1):
            # Captured at registration. The old fallback printed the raw uuid
            # ("user:e34d1980-…") straight onto the scoreboard.
            if r.team_id is not None:
                display_name = r.team_name or "Unnamed team"
            else:
                display_name = r.display_name or f"player-{str(r.user_id)[:8]}"
            entries.append(
                LeaderboardEntry(
                    rank=i,
                    participant_id=UUID(r.participant_id),
                    participant_type="team" if r.team_id is not None else "user",
                    user_id=UUID(r.user_id) if r.user_id else None,
                    team_id=r.team_id,
                    display_name=display_name,
                    points=int(r.points),
                    solve_count=int(r.solve_count),
                    last_solve_at=r.last_solve_at,
                    country_code=r.country_code or None,
                    first_bloods=int(r.first_bloods or 0),
                )
            )
        return entries, False

    async def export_scoreboard_csv(self, event_id: UUID) -> str:
        """Generate CSV scoreboard for organizer download."""
        entries, _ = await self.get_leaderboard(event_id, viewer_is_organizer=True, limit=10_000)
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow([
            "rank", "participant_id", "type", "user_id", "team_id",
            "display_name", "points", "solve_count", "last_solve_at",
        ])
        for e in entries:
            writer.writerow([
                e.rank,
                str(e.participant_id),
                e.participant_type,
                str(e.user_id) if e.user_id else "",
                str(e.team_id) if e.team_id else "",
                e.display_name,
                e.points,
                e.solve_count,
                e.last_solve_at.isoformat() if e.last_solve_at else "",
            ])
        return buf.getvalue()

    # =========================================================================
    # Snapshot for freeze
    # =========================================================================

    async def snapshot_scoreboard(self, event_id: UUID) -> None:
        """Capture the current live leaderboard into frozen_scoreboards.

        Called by the celery beat job when scoreboard_freeze_at is reached.
        """
        entries, _ = await self.get_leaderboard(
            event_id, viewer_is_organizer=True, limit=10_000
        )
        payload = [e.model_dump(mode="json") for e in entries]

        # Upsert
        existing = await self.session.execute(
            select(FrozenScoreboard).where(FrozenScoreboard.event_id == event_id)
        )
        snap = existing.scalar_one_or_none()
        if snap:
            snap.snapshot = payload
            snap.frozen_at = datetime.now(timezone.utc)
        else:
            self.session.add(
                FrozenScoreboard(
                    event_id=event_id,
                    frozen_at=datetime.now(timezone.utc),
                    snapshot=payload,
                )
            )
        await self.session.flush()
        log.info("scoreboard_frozen", event_id=str(event_id), entry_count=len(payload))
