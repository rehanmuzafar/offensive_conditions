"""Certificates for players who took part in a finished CTF.

Two rules decide who gets one, and both are deliberate.

The event must be over. A certificate issued while the scoreboard is still
moving would state a rank that is about to change.

The player must have solved at least one challenge. Registering is not taking
part, and a certificate that everyone who clicked a button can claim says
nothing about anyone. This is the line the organiser asked for and it is the
one that makes the document mean something.

What gets printed is written down at claim time rather than recomputed on every
view — see EventCertificate for why.
"""

from __future__ import annotations

import secrets
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import Integer, and_, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, ErrorCode
from app.core.logging import get_logger
from app.models import (
    Event,
    EventCertificate,
    EventChallenge,
    EventParticipant,
    EventSolve,
)

log = get_logger("certificates")


class CertificateService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # ------------------------------------------------------------------ checks
    async def _load_event(self, event_id: UUID) -> Event:
        event = (
            await self.session.execute(select(Event).where(Event.id == event_id))
        ).scalar_one_or_none()
        if event is None:
            raise AppError(ErrorCode.EVENT_NOT_FOUND, "event not found")
        return event

    async def eligibility(self, event_id: UUID, user_id: UUID) -> dict[str, Any]:
        """Whether this player may claim, and if not, why.

        Returns a reason rather than a bare false so the button can say what is
        missing — "the event has not finished" and "you did not solve anything"
        are very different messages to receive.
        """
        event = await self._load_event(event_id)
        now = datetime.now(timezone.utc)

        if now < event.ends_at:
            return {"eligible": False, "reason": "event_not_finished",
                    "message": "certificates open once the event ends"}

        participant = (
            await self.session.execute(
                select(EventParticipant).where(
                    and_(
                        EventParticipant.event_id == event_id,
                        EventParticipant.user_id == user_id,
                    )
                )
            )
        ).scalar_one_or_none()
        if participant is None:
            return {"eligible": False, "reason": "not_registered",
                    "message": "you did not take part in this event"}

        solves = (
            await self.session.execute(
                select(func.count())
                .select_from(EventSolve)
                .where(
                    and_(
                        EventSolve.event_id == event_id,
                        EventSolve.solving_user_id == user_id,
                    )
                )
            )
        ).scalar_one()
        if not solves:
            return {"eligible": False, "reason": "no_solves",
                    "message": "a certificate needs at least one solved challenge"}

        existing = await self.find(event_id, user_id)
        return {
            "eligible": True,
            "reason": None,
            "message": None,
            "already_claimed": existing is not None,
            "certificate_no": existing.certificate_no if existing else None,
        }

    async def find(self, event_id: UUID, user_id: UUID) -> EventCertificate | None:
        return (
            await self.session.execute(
                select(EventCertificate).where(
                    and_(
                        EventCertificate.event_id == event_id,
                        EventCertificate.user_id == user_id,
                    )
                )
            )
        ).scalar_one_or_none()

    async def by_number(self, certificate_no: str) -> EventCertificate | None:
        """For the public verification page."""
        return (
            await self.session.execute(
                select(EventCertificate).where(
                    EventCertificate.certificate_no == certificate_no.upper()
                )
            )
        ).scalar_one_or_none()

    # ------------------------------------------------------------------- claim
    async def claim(
        self, event_id: UUID, user_id: UUID, *, username: str | None = None
    ) -> EventCertificate:
        """Issue a certificate, or hand back the one already issued.

        Claiming twice is not an error and must not mint a second document: the
        figures could differ from the first, and two certificates for one player
        in one event is exactly the thing a verification page exists to catch.
        """
        check = await self.eligibility(event_id, user_id)
        if not check["eligible"]:
            raise AppError(ErrorCode.FORBIDDEN, check["message"])

        existing = await self.find(event_id, user_id)
        if existing is not None:
            return existing

        event = await self._load_event(event_id)
        participant = (
            await self.session.execute(
                select(EventParticipant).where(
                    and_(
                        EventParticipant.event_id == event_id,
                        EventParticipant.user_id == user_id,
                    )
                )
            )
        ).scalar_one()

        # This player's own solves. Deductions are subtracted because that is
        # what the scoreboard counted — a hint taken is a hint paid for, and a
        # certificate claiming the undeducted figure would not match the rank.
        own = (
            await self.session.execute(
                select(
                    func.count(EventSolve.id),
                    func.coalesce(
                        func.sum(EventSolve.points_at_solve - EventSolve.point_deduction), 0
                    ),
                    func.coalesce(func.sum(func.cast(EventSolve.is_first_blood, Integer)), 0),
                ).where(
                    and_(
                        EventSolve.event_id == event_id,
                        EventSolve.solving_user_id == user_id,
                    )
                )
            )
        ).one()
        solved_count, own_points, first_bloods = int(own[0]), int(own[1]), int(own[2])

        total_challenges = (
            await self.session.execute(
                select(func.count())
                .select_from(EventChallenge)
                .where(EventChallenge.event_id == event_id)
            )
        ).scalar_one()

        # Rank comes from the same function the scoreboard page uses, so the
        # certificate cannot disagree with what the player saw. Imported here
        # rather than at module scope to keep the two services from importing
        # each other.
        from app.services.events import EventService

        entries, _ = await EventService(self.session).get_leaderboard(
            event_id, viewer_is_organizer=True, limit=10_000
        )
        mine = next(
            (
                e
                for e in entries
                if (participant.team_id and e.team_id == participant.team_id)
                or (not participant.team_id and e.user_id == user_id)
            ),
            None,
        )

        total_players = (
            await self.session.execute(
                select(func.count())
                .select_from(EventParticipant)
                .where(EventParticipant.event_id == event_id)
            )
        ).scalar_one()
        total_teams = (
            await self.session.execute(
                select(func.count(func.distinct(EventParticipant.team_id))).where(
                    and_(
                        EventParticipant.event_id == event_id,
                        EventParticipant.team_id.isnot(None),
                    )
                )
            )
        ).scalar_one()

        snapshot: dict[str, Any] = {
            "username": username or "",
            "team_name": participant.team_name_at_event,
            # Solo events have no team, so the rank is the player's own. The
            # document says which of the two it is rather than printing "team
            # rank" above a number that is nothing of the sort.
            "is_team_event": participant.team_id is not None,
            "rank": mine.rank if mine else None,
            "team_points": mine.points if mine else None,
            "solved": solved_count,
            "total_challenges": int(total_challenges),
            "points": own_points,
            "first_bloods": first_bloods,
            "total_teams": int(total_teams),
            "total_players": int(total_players),
            "event_name": event.name,
            "event_slug": event.slug,
            "event_starts_at": event.starts_at.isoformat(),
            "event_ends_at": event.ends_at.isoformat(),
        }

        cert = EventCertificate(
            event_id=event_id,
            user_id=user_id,
            certificate_no=_certificate_number(event.slug),
            snapshot=snapshot,
        )
        self.session.add(cert)
        try:
            await self.session.flush()
        except IntegrityError:
            # Two clicks landing together. The unique index is what actually
            # prevents a second document; this just returns the winner.
            await self.session.rollback()
            again = await self.find(event_id, user_id)
            if again is not None:
                return again
            raise

        log.info(
            "certificate_claimed",
            event_id=str(event_id),
            user_id=str(user_id),
            certificate_no=cert.certificate_no,
            rank=snapshot["rank"],
            solved=solved_count,
        )
        return cert


def _certificate_number(slug: str) -> str:
    """A short, readable, unguessable handle.

    Printed on the document and used in the verification URL, so it has to be
    typeable off a page someone is holding. Random rather than sequential: a
    counter would let anyone enumerate every certificate ever issued, and tell
    them how many there are.
    """
    tag = "".join(c for c in slug.upper() if c.isalnum())[:6] or "CTF"
    return f"OFFCON-{tag}-{secrets.token_hex(3).upper()}"
