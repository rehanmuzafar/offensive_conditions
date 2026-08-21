"""Event service: CRUD, lifecycle, leaderboard."""

from __future__ import annotations

import csv
import io
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import and_, delete, func, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, ErrorCode
from app.core.logging import get_logger
from app.services.writeups import eliminated_now
from app.models import (
    Event,
    EventParticipant,
    EventWriteup,
    FrozenScoreboard,
    RankPin,
    ScoreAdjustment,
)
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


def _apply_pins(
    entries: list[LeaderboardEntry], pins: dict[str, tuple[int, str | None]]
) -> list[LeaderboardEntry]:
    """Move pinned entries to their fixed positions and renumber everything.

    The natural order is kept for everyone else, so a pin displaces rather than
    reshuffles: pinning one team to 2nd pushes the team that was 2nd down by
    one, and nobody else changes relative order.

    A position past the end of the board settles at the end rather than leaving
    a gap — ranks have to run 1..n with nothing missing, or "who came third?"
    has no answer.
    """
    if not pins:
        return entries

    pinned: list[tuple[int, LeaderboardEntry]] = []
    rest: list[LeaderboardEntry] = []
    for entry in entries:
        pin = pins.get(_subject_of(entry))
        if pin is None:
            rest.append(entry)
            continue
        position, reason = pin
        entry.pinned = True
        entry.pinned_reason = reason
        pinned.append((position, entry))

    # Lowest position first, so two pins never fight over the same insert index.
    pinned.sort(key=lambda pair: pair[0])
    ordered = rest
    for position, entry in pinned:
        index = min(max(position - 1, 0), len(ordered))
        ordered.insert(index, entry)

    for rank, entry in enumerate(ordered, start=1):
        entry.rank = rank
    return ordered


def _subject_of(entry: LeaderboardEntry) -> str:
    """The scoreboard's grouping key for one entry.

    Must match the `grp` expression in the leaderboard query — a team is its id,
    a solo player is their user id behind a prefix so the two cannot collide.
    """
    return str(entry.team_id) if entry.team_id else f"user:{entry.user_id}"


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
            # registration_ends_at is deliberately NOT frozen: an organiser
            # keeping the doors open — or closing them early — is a decision
            # about a running event, not a rewrite of its history. Moving when
            # it *started* still is, so that stays blocked.
            frozen = {"starts_at", "registration_starts_at"}
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

    async def delete(self, event_id: UUID, *, actor_id: UUID, is_organizer: bool = False) -> None:
        """Remove an event and everything under it.

        This method existed with no authorisation check at all — it deleted
        whatever id it was handed. Nothing routed to it, so nothing was exposed,
        but it was a loaded gun. It now enforces the same rule the rest of the
        lifecycle does: an organizer, or the person who created the event.

        A running event cannot be deleted. Standings, solves and first bloods
        are live at that point and there is no undo; ending it first is a
        deliberate, reversible step, and deleting it afterwards is not.
        """
        event = await self.get(event_id)

        if not is_organizer and event.created_by != actor_id:
            raise AppError(ErrorCode.NOT_ORGANIZER, "only the organizer can delete this event")

        if event.status == "live":
            raise AppError(
                ErrorCode.INVALID_STATUS_TRANSITION,
                "end the event before deleting it",
            )

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
    # Pause
    #
    # Pausing does not change status. The event stays live; it simply stops
    # accepting play, and every "is this live?" query elsewhere keeps its
    # meaning. See migration 0010.
    # =========================================================================

    async def set_pause(
        self,
        event_id: UUID,
        *,
        actor_id: UUID,
        is_organizer: bool,
        paused: bool | None = None,
        starts_at: datetime | None = None,
        ends_at: datetime | None = None,
        reason: str | None = None,
    ) -> Event:
        """Pause or resume, by hand or on a schedule.

        `paused=True` holds it until someone resumes. `paused=False` resumes now
        and *clears any scheduled window* — an organiser who presses resume
        means the event is running, and leaving a schedule armed would pause it
        again behind them. That is the whole of "resuming early ends the
        schedule".
        """
        event = await self.get(event_id)
        if not is_organizer and event.created_by != actor_id:
            raise AppError(ErrorCode.NOT_ORGANIZER, "only the organizer can pause this event")

        if paused is True:
            event.paused_at = datetime.now(timezone.utc)
            event.pause_reason = reason
        elif paused is False:
            event.paused_at = None
            event.pause_starts_at = None
            event.pause_ends_at = None
            event.pause_reason = None

        # Scheduling is independent of the manual flag, so an organiser can line
        # up tonight's maintenance window while the event runs normally.
        if starts_at is not None or ends_at is not None:
            if starts_at is None or ends_at is None:
                raise AppError(
                    ErrorCode.VALIDATION, "a scheduled pause needs both a start and an end"
                )
            if ends_at <= starts_at:
                raise AppError(ErrorCode.VALIDATION, "the pause must end after it starts")
            event.pause_starts_at = starts_at
            event.pause_ends_at = ends_at
            if reason is not None:
                event.pause_reason = reason

        await self.session.flush()
        await self.session.refresh(event)
        log.info(
            "event_pause_changed",
            event_id=str(event_id),
            paused=event.is_paused,
            manual=event.paused_at is not None,
            scheduled=bool(event.pause_starts_at),
            actor=str(actor_id),
        )
        return event

    async def clear_pause_schedule(self, event_id: UUID, *, actor_id: UUID, is_organizer: bool) -> Event:
        """Drop a scheduled window without touching the manual flag."""
        event = await self.get(event_id)
        if not is_organizer and event.created_by != actor_id:
            raise AppError(ErrorCode.NOT_ORGANIZER, "only the organizer can pause this event")
        event.pause_starts_at = None
        event.pause_ends_at = None
        await self.session.flush()
        await self.session.refresh(event)
        return event

    # =========================================================================
    # Organiser score control
    # =========================================================================

    async def adjust_score(
        self,
        event_id: UUID,
        *,
        actor_id: UUID,
        is_organizer: bool,
        delta: int,
        reason: str | None = None,
        visible: bool = False,
        team_id: UUID | None = None,
        user_id: UUID | None = None,
    ) -> ScoreAdjustment:
        """Award or deduct points from one entry.

        Works in every state the event can be in — before it starts, while it
        runs and after it ends — because that is when the reasons arise: a
        pre-event sanction, a live penalty for flag sharing, a jury correction
        once the dust settles.

        The row is never edited afterwards. An adjustment made in error is
        cancelled by its opposite, so what actually happened stays legible.
        """
        event = await self.get(event_id)
        if not is_organizer and event.created_by != actor_id:
            raise AppError(ErrorCode.NOT_ORGANIZER, "only the organizer can change scores")

        if delta == 0:
            raise AppError(ErrorCode.VALIDATION, "an adjustment of zero changes nothing")
        # Only required when it will be published: the board cannot show
        # "+50" with nothing beside it. A quiet correction has nothing to
        # announce, and demanding a sentence there produces "asdf" rather than
        # an audit trail.
        if visible and not (reason or "").strip():
            raise AppError(
                ErrorCode.VALIDATION,
                "a bonus shown on the scoreboard needs a reason to show with it",
            )
        if (team_id is None) == (user_id is None):
            raise AppError(ErrorCode.VALIDATION, "adjust either a team or a player, not both")

        # The subject has to actually be in this event, or the adjustment would
        # sit in the table affecting nothing and look like it had been applied.
        exists = await self.session.execute(
            select(EventParticipant.id).where(
                and_(
                    EventParticipant.event_id == event_id,
                    EventParticipant.team_id == team_id
                    if team_id is not None
                    else EventParticipant.user_id == user_id,
                )
            )
        )
        if exists.first() is None:
            raise AppError(ErrorCode.VALIDATION, "that entry is not registered for this event")

        adjustment = ScoreAdjustment(
            event_id=event_id,
            team_id=team_id,
            user_id=user_id,
            delta=delta,
            reason=(reason or "").strip() or None,
            visible=visible,
            actor_id=actor_id,
        )
        self.session.add(adjustment)
        await self.session.flush()
        log.info(
            "score_adjusted",
            event_id=str(event_id),
            team_id=str(team_id) if team_id else None,
            user_id=str(user_id) if user_id else None,
            delta=delta,
            actor=str(actor_id),
        )
        return adjustment

    async def set_rank_pin(
        self,
        event_id: UUID,
        *,
        actor_id: UUID,
        is_organizer: bool,
        position: int,
        reason: str | None = None,
        team_id: UUID | None = None,
        user_id: UUID | None = None,
    ) -> RankPin:
        """Fix an entry at a position, replacing any pin it or the slot had.

        Both replacements matter. A team can only be in one place, and a place
        can only hold one team — without either rule the board stops being able
        to answer "who came second?".
        """
        event = await self.get(event_id)
        if not is_organizer and event.created_by != actor_id:
            raise AppError(ErrorCode.NOT_ORGANIZER, "only the organizer can pin a rank")
        if (team_id is None) == (user_id is None):
            raise AppError(ErrorCode.VALIDATION, "pin either a team or a player, not both")
        if position < 1:
            raise AppError(ErrorCode.VALIDATION, "positions start at 1")

        subject = (
            RankPin.team_id == team_id if team_id is not None else RankPin.user_id == user_id
        )
        # Clear whatever held this slot, and whatever this entry held before.
        await self.session.execute(
            delete(RankPin).where(
                and_(
                    RankPin.event_id == event_id,
                    or_(RankPin.position == position, subject),
                )
            )
        )

        pin = RankPin(
            event_id=event_id,
            team_id=team_id,
            user_id=user_id,
            position=position,
            reason=(reason or "").strip() or None,
            actor_id=actor_id,
        )
        self.session.add(pin)
        await self.session.flush()
        log.info(
            "rank_pinned",
            event_id=str(event_id),
            position=position,
            team_id=str(team_id) if team_id else None,
            actor=str(actor_id),
        )
        return pin

    async def reorder_board(
        self,
        event_id: UUID,
        *,
        actor_id: UUID,
        is_organizer: bool,
        order: list[dict[str, Any]],
        reason: str | None = None,
    ) -> int:
        """Set the whole displayed order at once, from a dragged list.

        Dragging is the natural way to say "this team finishes third": the
        organiser moves one row and everything between shifts by one, exactly
        as a playlist behaves. Expressing that as a series of single pins would
        make the intermediate states visible and, if one call failed, leave the
        board half-reordered.

        So the client sends the final order and this replaces every pin in one
        transaction. Rows left in their natural position are not pinned at all —
        only the ones the organiser actually moved — so the board keeps ordering
        by points wherever nobody has overruled it.
        """
        event = await self.get(event_id)
        if not is_organizer and event.created_by != actor_id:
            raise AppError(ErrorCode.NOT_ORGANIZER, "only the organizer can reorder the board")

        await self.session.execute(delete(RankPin).where(RankPin.event_id == event_id))

        written = 0
        for index, row in enumerate(order, start=1):
            team_id = row.get("team_id")
            user_id = row.get("user_id")
            if (team_id is None) == (user_id is None):
                raise AppError(ErrorCode.VALIDATION, "each row names a team or a player")
            # Only the moved rows are pinned; the rest stay free to follow points.
            if not row.get("pinned", True):
                continue
            self.session.add(
                RankPin(
                    event_id=event_id,
                    team_id=UUID(str(team_id)) if team_id else None,
                    user_id=UUID(str(user_id)) if user_id else None,
                    position=index,
                    reason=(reason or "").strip() or None,
                    actor_id=actor_id,
                )
            )
            written += 1

        await self.session.flush()
        log.info("board_reordered", event_id=str(event_id), pinned=written, actor=str(actor_id))
        return written

    async def clear_rank_pin(
        self,
        event_id: UUID,
        *,
        actor_id: UUID,
        is_organizer: bool,
        team_id: UUID | None = None,
        user_id: UUID | None = None,
    ) -> None:
        """Release an entry back to where its points put it."""
        event = await self.get(event_id)
        if not is_organizer and event.created_by != actor_id:
            raise AppError(ErrorCode.NOT_ORGANIZER, "only the organizer can pin a rank")
        subject = (
            RankPin.team_id == team_id if team_id is not None else RankPin.user_id == user_id
        )
        await self.session.execute(
            delete(RankPin).where(and_(RankPin.event_id == event_id, subject))
        )
        await self.session.flush()

    async def list_rank_pins(self, event_id: UUID) -> list[RankPin]:
        rows = await self.session.execute(
            select(RankPin).where(RankPin.event_id == event_id).order_by(RankPin.position)
        )
        return list(rows.scalars())

    async def list_entries_for_admin(self, event_id: UUID) -> list[dict[str, Any]]:
        """Every entry in the event, banned ones included.

        The leaderboard cannot serve this: it filters out disqualified rows, so
        a banned team would disappear from the very screen an organiser needs to
        reinstate it from. It also folds adjustments into one number, and an
        organiser wants to see earned points and adjustments apart before
        changing either.
        """
        rows = (
            await self.session.execute(
                text(
                    """
                    SELECT COALESCE(p.team_id::text, 'user:' || p.user_id::text) AS grp,
                           p.team_id                                     AS team_id,
                           CASE WHEN p.team_id IS NULL
                                THEN MIN(p.user_id::text) END            AS user_id,
                           MAX(COALESCE(NULLIF(p.team_name_at_event, ''), '')) AS team_name,
                           MAX(COALESCE(NULLIF(p.display_name, ''), ''))       AS display_name,
                           COUNT(*)::INT                                 AS member_count,
                           SUM(p.points)::BIGINT                         AS earned,
                           SUM(p.solve_count)::BIGINT                    AS solve_count,
                           BOOL_OR(p.is_disqualified)                    AS banned,
                           MAX(COALESCE(p.disqualification_reason, ''))  AS ban_reason,
                           COALESCE(MAX(adj.total), 0)::BIGINT           AS adjustment
                      FROM ctf.event_participants p
                      LEFT JOIN (
                            SELECT event_id,
                                   COALESCE(team_id::text, 'user:' || user_id::text) AS subject,
                                   SUM(delta)::BIGINT AS total
                              FROM ctf.score_adjustments
                             GROUP BY event_id, subject
                      ) adj ON adj.event_id = p.event_id
                           AND adj.subject = COALESCE(p.team_id::text, 'user:' || p.user_id::text)
                     WHERE p.event_id = :event_id
                     GROUP BY grp, p.team_id
                     ORDER BY (SUM(p.points) + COALESCE(MAX(adj.total), 0)) DESC
                    """
                ),
                {"event_id": event_id},
            )
        ).all()

        # The current pin travels with the row so the organiser can see and clear
        # it where they set it, instead of hunting for it on another screen.
        pins = await self._rank_pins(event_id)

        return [
            {
                "team_id": str(r.team_id) if r.team_id else None,
                "user_id": r.user_id,
                "pinned_position": pins.get(r.grp, (None, None))[0],
                "pinned_reason": pins.get(r.grp, (None, None))[1],
                "name": (r.team_name or "Unnamed team")
                if r.team_id
                else (r.display_name or f"player-{str(r.user_id)[:8]}"),
                "is_team": r.team_id is not None,
                "member_count": int(r.member_count),
                "earned_points": int(r.earned),
                "adjustment": int(r.adjustment),
                "points": int(r.earned) + int(r.adjustment),
                "solve_count": int(r.solve_count),
                "banned": bool(r.banned),
                "ban_reason": r.ban_reason or None,
            }
            for r in rows
        ]

    async def list_adjustments(self, event_id: UUID) -> list[ScoreAdjustment]:
        rows = await self.session.execute(
            select(ScoreAdjustment)
            .where(ScoreAdjustment.event_id == event_id)
            .order_by(ScoreAdjustment.created_at.desc())
        )
        return list(rows.scalars())

    async def set_disqualified(
        self,
        event_id: UUID,
        *,
        actor_id: UUID,
        is_organizer: bool,
        banned: bool,
        reason: str | None = None,
        team_id: UUID | None = None,
        user_id: UUID | None = None,
    ) -> int:
        """Ban or reinstate an entry. Returns how many participant rows changed.

        A team is several participant rows, so a ban has to reach all of them —
        the leaderboard filters `NOT is_disqualified` per row, and banning one
        member would simply subtract that member's points while the team played
        on.

        Nothing is deleted. A banned team keeps its solves and can be
        reinstated, which matters when a ban turns out to be a mistake mid-event.
        """
        event = await self.get(event_id)
        if not is_organizer and event.created_by != actor_id:
            raise AppError(ErrorCode.NOT_ORGANIZER, "only the organizer can ban a team")
        if (team_id is None) == (user_id is None):
            raise AppError(ErrorCode.VALIDATION, "ban either a team or a player, not both")
        if banned and (not reason or not reason.strip()):
            raise AppError(ErrorCode.VALIDATION, "give a reason for the ban")

        where = (
            EventParticipant.team_id == team_id
            if team_id is not None
            else EventParticipant.user_id == user_id
        )
        result = await self.session.execute(
            EventParticipant.__table__.update()
            .where(and_(EventParticipant.event_id == event_id, where))
            .values(
                is_disqualified=banned,
                disqualification_reason=reason.strip() if (banned and reason) else None,
            )
        )
        await self.session.flush()
        changed = result.rowcount or 0
        if changed == 0:
            raise AppError(ErrorCode.VALIDATION, "that entry is not registered for this event")
        log.info(
            "participant_disqualified",
            event_id=str(event_id),
            team_id=str(team_id) if team_id else None,
            user_id=str(user_id) if user_id else None,
            banned=banned,
            rows=changed,
            actor=str(actor_id),
        )
        return changed

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
                           -- Earned points plus whatever the organisers moved
                           -- by hand. The two are summed here rather than
                           -- merged in storage so per-player stats keep meaning
                           -- "what this player solved". See migration 0012.
                           (SUM(p.points) + COALESCE(MAX(adj.total), 0))::BIGINT AS points,
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
                      -- One row per subject, so MAX() above picks the single
                      -- value rather than counting it once per team member.
                      -- `subject`, not `grp`: exposing a column called grp here
                      -- shadows the output alias the outer GROUP BY refers to,
                      -- and Postgres then reads `GROUP BY grp` as this column —
                      -- leaving p.user_id ungrouped and the query invalid.
                      LEFT JOIN (
                            SELECT event_id,
                                   COALESCE(team_id::text, 'user:' || user_id::text) AS subject,
                                   SUM(delta)::BIGINT AS total
                              FROM ctf.score_adjustments
                             GROUP BY event_id, subject
                      ) adj ON adj.event_id = p.event_id
                           AND adj.subject = COALESCE(p.team_id::text, 'user:' || p.user_id::text)
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

        # Published bonuses, so the board can explain a number that did not come
        # from a solve. Quiet adjustments still count toward points above; they
        # simply have nothing to say here.
        shown = await self._visible_adjustments(event_id)
        for entry in entries:
            entry.bonuses = shown.get(_subject_of(entry), [])

        # Applied last: a pin is about the final displayed order, so it has to
        # sit on top of the points ordering rather than inside it.
        return _apply_pins(entries, await self._rank_pins(event_id)), False

    async def _rank_pins(self, event_id: UUID) -> dict[str, tuple[int, str | None]]:
        rows = await self.session.execute(
            select(RankPin.team_id, RankPin.user_id, RankPin.position, RankPin.reason).where(
                RankPin.event_id == event_id
            )
        )
        return {
            (str(team_id) if team_id else f"user:{user_id}"): (position, reason)
            for team_id, user_id, position, reason in rows
        }

    async def _visible_adjustments(self, event_id: UUID) -> dict[str, list[dict[str, Any]]]:
        rows = await self.session.execute(
            select(
                ScoreAdjustment.team_id,
                ScoreAdjustment.user_id,
                ScoreAdjustment.delta,
                ScoreAdjustment.reason,
            )
            .where(
                and_(
                    ScoreAdjustment.event_id == event_id,
                    ScoreAdjustment.visible.is_(True),
                )
            )
            .order_by(ScoreAdjustment.created_at.asc())
        )
        out: dict[str, list[dict[str, Any]]] = {}
        for team_id, user_id, delta, reason in rows:
            subject = str(team_id) if team_id else f"user:{user_id}"
            out.setdefault(subject, []).append({"delta": delta, "reason": reason or ""})
        return out

    async def get_board(
        self,
        event_id: UUID,
        *,
        viewer_is_organizer: bool,
        limit: int = 100,
    ) -> tuple[list[LeaderboardEntry], list[LeaderboardEntry], bool]:
        """The scoreboard, split into standing and eliminated.

        Elimination is computed here rather than stored. A team owed a writeup,
        the deadline passed, no writeup arrived — that is a fact about the clock
        and the rows, so it becomes true at the right moment on its own and stops
        being true the instant an organiser extends the deadline or the writeup
        lands. A stored flag would need keeping in step with both.

        Who owed one is decided by the ranking *before* elimination, which is
        what `get_leaderboard` returns. Deciding it after would be circular:
        eliminating third place promotes fourth into the top three, who would
        then owe a writeup nobody ever asked them for.

        Survivors are renumbered, so an eliminated team's position is taken by
        the team behind it — the scoreboard has no gaps.
        """
        entries, frozen = await self.get_leaderboard(
            event_id, viewer_is_organizer=viewer_is_organizer, limit=limit
        )
        # A frozen board is a snapshot of a moment; re-deriving it now would
        # contradict the thing it exists to preserve.
        if frozen:
            return entries, [], True

        event = await self.get(event_id)
        if not event.writeup_required_top_n or not event.writeup_deadline:
            return entries, [], False

        submitted = await self._submitted_writeup_subjects(event_id)
        gone = eliminated_now(
            event,
            ranked=[{"subject": _subject_of(e)} for e in entries],
            submitted_subjects=submitted,
        )
        if not gone:
            return entries, [], False

        standing: list[LeaderboardEntry] = []
        eliminated: list[LeaderboardEntry] = []
        for entry in entries:
            (eliminated if _subject_of(entry) in gone else standing).append(entry)
        # Close the gaps the eliminated rows left, then re-apply the pins:
        # removing a team shifts every position below it, and a pin is a
        # statement about the *final* board, not the one before elimination.
        for position, entry in enumerate(standing, start=1):
            entry.rank = position
        standing = _apply_pins(standing, await self._rank_pins(event_id))
        return standing, eliminated, False

    async def _submitted_writeup_subjects(self, event_id: UUID) -> set[str]:
        """Entries that have actually turned one in. Drafts do not count."""
        rows = await self.session.execute(
            select(EventWriteup.team_id, EventWriteup.user_id).where(
                and_(
                    EventWriteup.event_id == event_id,
                    EventWriteup.status == "submitted",
                )
            )
        )
        subjects: set[str] = set()
        for team_id, user_id in rows:
            subjects.add(str(team_id) if team_id else f"user:{user_id}")
        return subjects

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
