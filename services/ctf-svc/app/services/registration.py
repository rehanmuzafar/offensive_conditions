"""Registration service: solo + team registration."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import AppError, ErrorCode
from app.services.user_client import UserServiceClient
from app.core.logging import get_logger
from app.models import Event, EventParticipant

log = get_logger("registration")


class RegistrationService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def _load_event(self, event_id: UUID) -> Event:
        result = await self.session.execute(select(Event).where(Event.id == event_id))
        event = result.scalar_one_or_none()
        if not event:
            raise AppError(ErrorCode.EVENT_NOT_FOUND, "event not found")
        return event

    async def _check_registration_window(self, event: Event) -> None:
        now = datetime.now(timezone.utc)
        if event.status not in ("published", "registration", "live"):
            raise AppError(
                ErrorCode.EVENT_NOT_REGISTRATION_OPEN,
                f"registration not open (status={event.status})",
            )
        if now < event.registration_starts_at:
            raise AppError(
                ErrorCode.EVENT_NOT_REGISTRATION_OPEN,
                "registration not yet open",
            )
        if now > event.registration_ends_at:
            raise AppError(
                ErrorCode.EVENT_NOT_REGISTRATION_OPEN,
                "registration window closed",
            )

    async def _check_capacity(self, event: Event) -> None:
        if event.max_participants is None:
            return
        if event.total_registered >= event.max_participants:
            raise AppError(ErrorCode.EVENT_REGISTRATION_FULL, "event is full")

    async def _check_invitation(self, event: Event, code: str | None) -> None:
        if not event.invitation_only and event.visibility != "private":
            return
        if not event.invitation_code:
            return
        if not code:
            raise AppError(ErrorCode.EVENT_INVITATION_REQUIRED, "invitation code required")
        if code.strip() != event.invitation_code:
            raise AppError(ErrorCode.EVENT_INVITATION_INVALID, "invalid invitation code")

    # =========================================================================
    # Solo registration
    # =========================================================================

    async def _recount_teams(self, event_id: UUID) -> None:
        """Set total_teams from the rows, rather than nudging a counter.

        The counter was kept by hand and the two sides did not agree: only the
        legacy whole-team path incremented it, while unregistering decremented
        it for any team row — including the per-player rows that never added to
        it. Several teammates share one team, so a delta-per-row counter cannot
        be right anyway; the distinct count can.
        """
        total = await self.session.scalar(
            select(func.count(func.distinct(EventParticipant.team_id))).where(
                and_(
                    EventParticipant.event_id == event_id,
                    EventParticipant.team_id.is_not(None),
                )
            )
        )
        await self.session.execute(
            Event.__table__.update().where(Event.id == event_id).values(total_teams=total or 0)
        )

    async def team_registration_counts(self, event_id: UUID) -> dict[UUID, int]:
        """How many players have entered under each team, for one event.

        Registration is per player: several teammates hold their own rows
        against the same team_id, which is why there is no unique constraint on
        (event_id, team_id). This is the count that makes a team's remaining
        slots knowable — both to the player choosing a team and to the check
        below that stops a fifth player entering a four-slot event.
        """
        rows = await self.session.execute(
            select(EventParticipant.team_id, func.count())
            .where(
                and_(
                    EventParticipant.event_id == event_id,
                    EventParticipant.team_id.is_not(None),
                )
            )
            .group_by(EventParticipant.team_id)
        )
        return {team_id: count for team_id, count in rows if team_id is not None}

    async def register_solo(
        self,
        event_id: UUID,
        *,
        user_id: UUID,
        invitation_code: str | None = None,
        display_name: str | None = None,
        team_id: UUID | None = None,
        team_name: str | None = None,
    ) -> EventParticipant:
        """Register one player.

        On a team event the caller names which of their teams they are playing
        for; teammates each register themselves against the same team_id. The
        caller's membership is verified upstream, so by here team_id is trusted.
        """
        event = await self._load_event(event_id)

        if event.team_play and not event.solo_play and team_id is None:
            raise AppError(
                ErrorCode.VALIDATION,
                "this is a team event — choose which of your teams you are playing for",
            )
        if not event.team_play and team_id is not None:
            raise AppError(ErrorCode.VALIDATION, "this event is solo only")
        if not event.solo_play and not event.team_play:
            raise AppError(ErrorCode.FORBIDDEN, "this event is not open for registration")

        await self._check_registration_window(event)
        await self._check_capacity(event)
        await self._check_invitation(event, invitation_code)

        # Already registered?
        existing = await self.session.execute(
            select(EventParticipant).where(
                and_(
                    EventParticipant.event_id == event_id,
                    EventParticipant.user_id == user_id,
                )
            )
        )
        if existing.scalar_one_or_none() is not None:
            raise AppError(ErrorCode.ALREADY_REGISTERED, "already registered for this event")

        # The event's team size is a cap on how many of a team may *enter*, not
        # on how many the team has. Nothing enforced it here, so a four-slot
        # event would happily take all ten members of a team; the front end
        # instead refused to let a big team register at all, which is the same
        # rule applied to the wrong number and in the wrong place.
        if team_id is not None and event.max_team_size:
            taken = (await self.team_registration_counts(event_id)).get(team_id, 0)
            if taken >= event.max_team_size:
                raise AppError(
                    ErrorCode.VALIDATION,
                    f"this team already has {taken} of {event.max_team_size} "
                    "players entered for this event",
                )

        # Paid events: the row is created immediately but stays 'pending' until
        # the payment provider confirms, so the seat is held without granting
        # access. Free events register outright.
        paid_event = (event.entry_fee_cents or 0) > 0
        participant = EventParticipant(
            event_id=event_id,
            # "team" means this player is representing a team; the row is still
            # theirs alone.
            participant_type="team" if team_id else "user",
            user_id=user_id,
            display_name=display_name,
            team_id=team_id,
            team_name_at_event=team_name,
            payment_status="pending" if paid_event else "not_required",
            payment_currency=event.currency if paid_event else None,
        )
        self.session.add(participant)
        try:
            await self.session.flush()
        except IntegrityError:
            await self.session.rollback()
            raise AppError(ErrorCode.ALREADY_REGISTERED, "already registered")

        # Only completed registrations count toward the participant total.
        if not paid_event:
            await self.session.execute(
                Event.__table__.update()
                .where(Event.id == event_id)
                .values(total_registered=Event.total_registered + 1)
            )
        if team_id is not None:
            await self._recount_teams(event_id)
        await self.session.flush()
        log.info(
            "solo_registered",
            payment_status=participant.payment_status,
            event_id=str(event_id),
            user_id=str(user_id),
            participant_id=str(participant.id),
        )
        return participant

    # =========================================================================
    # Team registration
    # =========================================================================

    async def register_team(
        self,
        event_id: UUID,
        *,
        captain_id: UUID,
        team_id: UUID,
        team_name: str,
        member_count: int,
        invitation_code: str | None = None,
    ) -> EventParticipant:
        event = await self._load_event(event_id)

        if not event.team_play:
            raise AppError(ErrorCode.FORBIDDEN, "this event does not allow team play")

        await self._check_registration_window(event)
        await self._check_capacity(event)
        await self._check_invitation(event, invitation_code)

        if event.max_team_size and member_count > event.max_team_size:
            raise AppError(
                ErrorCode.TEAM_SIZE_EXCEEDED,
                f"team size {member_count} exceeds limit {event.max_team_size}",
            )

        # Already registered?
        existing = await self.session.execute(
            select(EventParticipant).where(
                and_(
                    EventParticipant.event_id == event_id,
                    EventParticipant.team_id == team_id,
                )
            )
        )
        if existing.scalar_one_or_none() is not None:
            raise AppError(ErrorCode.ALREADY_REGISTERED, "team already registered")

        # Captain shouldn't be solo-registered either
        solo_check = await self.session.execute(
            select(EventParticipant.id).where(
                and_(
                    EventParticipant.event_id == event_id,
                    EventParticipant.user_id == captain_id,
                )
            )
        )
        if solo_check.scalar_one_or_none() is not None:
            raise AppError(
                ErrorCode.ALREADY_REGISTERED,
                "you are already solo-registered; unregister first",
            )

        participant = EventParticipant(
            event_id=event_id,
            participant_type="team",
            team_id=team_id,
            team_name_at_event=team_name,
        )
        self.session.add(participant)
        try:
            await self.session.flush()
        except IntegrityError:
            await self.session.rollback()
            raise AppError(ErrorCode.ALREADY_REGISTERED, "team already registered")

        await self.session.execute(
            Event.__table__.update()
            .where(Event.id == event_id)
            .values(total_registered=Event.total_registered + 1)
        )
        await self._recount_teams(event_id)
        await self.session.flush()
        log.info(
            "team_registered",
            event_id=str(event_id),
            team_id=str(team_id),
            captain=str(captain_id),
        )
        return participant

    # =========================================================================
    # Unregister
    # =========================================================================

    # =========================================================================
    # Captain roster control
    #
    # A team's slots belong to the team, not to whoever clicked first. On a
    # four-slot event a captain may find the wrong four entered — so they can
    # take a seat back and hand it to someone else.
    #
    # Only before the event starts. Once it is live a participant owns solves,
    # first bloods and a rank; removing them would either destroy that record or
    # leave it pointing at nobody, and no swap is worth an unreadable scoreboard.
    # =========================================================================

    async def roster(self, event_id: UUID, team_id: UUID) -> list[EventParticipant]:
        """Who from this team is entered in this event."""
        rows = await self.session.execute(
            select(EventParticipant).where(
                and_(
                    EventParticipant.event_id == event_id,
                    EventParticipant.team_id == team_id,
                )
            )
        )
        return list(rows.scalars())

    async def add_member(
        self,
        event_id: UUID,
        *,
        team_id: UUID,
        team_name: str,
        user_id: UUID,
    ) -> EventParticipant:
        """Enter one of the captain's teammates. Membership is checked upstream."""
        event = await self._load_event(event_id)
        if event.status not in ("published", "registration"):
            raise AppError(
                ErrorCode.EVENT_NOT_REGISTRATION_OPEN,
                "the roster is locked once the event starts",
            )

        existing = await self.session.execute(
            select(EventParticipant).where(
                and_(
                    EventParticipant.event_id == event_id,
                    EventParticipant.user_id == user_id,
                )
            )
        )
        if existing.scalar_one_or_none() is not None:
            raise AppError(ErrorCode.ALREADY_REGISTERED, "that player is already entered")

        if event.max_team_size:
            taken = (await self.team_registration_counts(event_id)).get(team_id, 0)
            if taken >= event.max_team_size:
                raise AppError(
                    ErrorCode.VALIDATION,
                    f"the team already has {taken} of {event.max_team_size} slots filled",
                )

        paid_event = (event.entry_fee_cents or 0) > 0
        participant = EventParticipant(
            event_id=event_id,
            participant_type="team",
            user_id=user_id,
            team_id=team_id,
            team_name_at_event=team_name,
            payment_status="pending" if paid_event else "not_required",
            payment_currency=event.currency if paid_event else None,
        )
        self.session.add(participant)
        try:
            await self.session.flush()
        except IntegrityError:
            await self.session.rollback()
            raise AppError(ErrorCode.ALREADY_REGISTERED, "that player is already entered")

        if not paid_event:
            await self.session.execute(
                Event.__table__.update()
                .where(Event.id == event_id)
                .values(total_registered=Event.total_registered + 1)
            )
        await self._recount_teams(event_id)
        await self.session.flush()
        log.info(
            "roster_added", event_id=str(event_id), team_id=str(team_id), user_id=str(user_id)
        )
        return participant

    async def remove_member(self, event_id: UUID, *, team_id: UUID, user_id: UUID) -> None:
        """Take back a slot from a teammate. Captaincy is checked upstream."""
        event = await self._load_event(event_id)
        if event.status not in ("published", "registration"):
            raise AppError(
                ErrorCode.EVENT_NOT_REGISTRATION_OPEN,
                "the roster is locked once the event starts",
            )

        result = await self.session.execute(
            select(EventParticipant).where(
                and_(
                    EventParticipant.event_id == event_id,
                    EventParticipant.user_id == user_id,
                    # Scoped to the captain's own team, so a captain cannot
                    # reach into another team's roster by guessing a user id.
                    EventParticipant.team_id == team_id,
                )
            )
        )
        participant = result.scalar_one_or_none()
        if not participant:
            raise AppError(ErrorCode.NOT_REGISTERED, "that player is not entered under this team")

        await self.session.delete(participant)
        await self.session.execute(
            Event.__table__.update()
            .where(Event.id == event_id)
            .values(total_registered=Event.total_registered - 1)
        )
        await self.session.flush()
        await self._recount_teams(event_id)
        await self.session.flush()
        log.info(
            "roster_removed", event_id=str(event_id), team_id=str(team_id), user_id=str(user_id)
        )

    async def unregister(self, event_id: UUID, *, user_id: UUID) -> None:
        event = await self._load_event(event_id)
        # Allow unregister only before event starts
        if event.status in ("live", "ended", "archived"):
            raise AppError(ErrorCode.EVENT_NOT_REGISTRATION_OPEN, "cannot unregister after start")

        # Find participation (solo or as team captain — assume captain auth verified upstream)
        result = await self.session.execute(
            select(EventParticipant).where(
                and_(
                    EventParticipant.event_id == event_id,
                    EventParticipant.user_id == user_id,
                )
            )
        )
        participant = result.scalar_one_or_none()
        if not participant:
            raise AppError(ErrorCode.NOT_REGISTERED, "you are not registered")

        await self.session.delete(participant)
        await self.session.execute(
            Event.__table__.update()
            .where(Event.id == event_id)
            .values(total_registered=Event.total_registered - 1)
        )
        await self.session.flush()
        await self._recount_teams(event_id)
        await self.session.flush()
        log.info("unregistered", event_id=str(event_id), user_id=str(user_id))

    # =========================================================================
    # Lookups
    # =========================================================================

    async def get_my_participation(
        self, event_id: UUID, *, user_id: UUID, bearer: str | None = None
    ) -> EventParticipant | None:
        """The caller's own registration row.

        Every registration now belongs to a person, so this is a direct lookup
        again — the previous model stored one row for a whole team with no
        user_id, which is why this used to need a user-svc round trip.
        """
        result = await self.session.execute(
            select(EventParticipant).where(
                and_(
                    EventParticipant.event_id == event_id,
                    EventParticipant.user_id == user_id,
                )
            )
        )
        return result.scalar_one_or_none()

    async def list_participants(
        self, event_id: UUID, *, limit: int = 100, offset: int = 0
    ) -> tuple[list[EventParticipant], int]:
        await self._load_event(event_id)
        stmt = (
            select(EventParticipant)
            .where(EventParticipant.event_id == event_id)
            .order_by(EventParticipant.registered_at.asc())
        )
        count_stmt = (
            select(func.count())
            .select_from(EventParticipant)
            .where(EventParticipant.event_id == event_id)
        )
        total = (await self.session.execute(count_stmt)).scalar_one()
        result = await self.session.execute(stmt.limit(limit).offset(offset))
        return list(result.scalars().all()), int(total)

    async def disqualify(
        self, event_id: UUID, participant_id: UUID, *, reason: str
    ) -> EventParticipant:
        result = await self.session.execute(
            select(EventParticipant).where(
                and_(
                    EventParticipant.event_id == event_id,
                    EventParticipant.id == participant_id,
                )
            )
        )
        participant = result.scalar_one_or_none()
        if not participant:
            raise AppError(ErrorCode.NOT_FOUND, "participant not found")
        participant.is_disqualified = True
        participant.disqualification_reason = reason
        await self.session.flush()
        log.warning(
            "participant_disqualified",
            event_id=str(event_id),
            participant_id=str(participant_id),
            reason=reason,
        )
        return participant
