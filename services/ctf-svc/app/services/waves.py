"""Event waves: staged release windows that challenges belong to.

A wave opens at `starts_at` and shuts at `ends_at`, or at the event's own end
when that is NULL. While a wave is closed its challenges stay visible — players
need to see what they solved — but the submit path refuses them, which is what
gives a wave's end time any meaning.

Challenges with no wave are open from the event's start even on an event that
uses waves, so a half-filed setup stays playable instead of hiding rounds an
organiser has not assigned yet.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, ErrorCode
from app.core.logging import get_logger
from app.models import Event, EventChallenge, EventWave
from app.schemas import EventWaveCreate, EventWaveUpdate

log = get_logger("waves")


class WaveService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # -- reads ---------------------------------------------------------------

    async def _event(self, event_id: UUID) -> Event:
        ev = (
            await self.session.execute(select(Event).where(Event.id == event_id))
        ).scalar_one_or_none()
        if not ev:
            raise AppError(ErrorCode.EVENT_NOT_FOUND, "event not found")
        return ev

    async def get(self, event_id: UUID, wave_id: UUID) -> EventWave:
        wave = (
            await self.session.execute(
                select(EventWave).where(
                    EventWave.id == wave_id, EventWave.event_id == event_id
                )
            )
        ).scalar_one_or_none()
        if not wave:
            raise AppError(ErrorCode.NOT_FOUND, "wave not found")
        return wave

    async def list_for_event(self, event_id: UUID) -> list[dict]:
        """Waves in order, each with its state and challenge count."""
        ev = await self._event(event_id)
        waves = (
            (
                await self.session.execute(
                    select(EventWave)
                    .where(EventWave.event_id == event_id)
                    .order_by(EventWave.position)
                )
            )
            .scalars()
            .all()
        )
        counts = dict(
            (
                await self.session.execute(
                    select(EventChallenge.wave_id, func.count())
                    .where(EventChallenge.event_id == event_id)
                    .group_by(EventChallenge.wave_id)
                )
            ).all()
        )
        now = datetime.now(timezone.utc)
        return [
            {
                "id": w.id,
                "event_id": w.event_id,
                "name": w.name,
                "position": w.position,
                "starts_at": w.starts_at,
                "ends_at": w.ends_at,
                "state": w.state(ev.ends_at, now),
                "challenge_count": counts.get(w.id, 0),
            }
            for w in waves
        ]

    async def open_wave_ids(self, event_id: UUID) -> set[UUID]:
        """Waves accepting submissions right now."""
        ev = await self._event(event_id)
        waves = (
            (
                await self.session.execute(
                    select(EventWave).where(EventWave.event_id == event_id)
                )
            )
            .scalars()
            .all()
        )
        now = datetime.now(timezone.utc)
        return {w.id for w in waves if w.state(ev.ends_at, now) == "live"}

    # -- writes --------------------------------------------------------------

    async def create(self, event_id: UUID, data: EventWaveCreate) -> EventWave:
        ev = await self._event(event_id)
        self._check_window(ev, data.starts_at, data.ends_at)

        # Append to the end. Positions are 1-based so the first wave reads as
        # "Wave 1" without the UI having to add one.
        last = (
            await self.session.execute(
                select(func.max(EventWave.position)).where(EventWave.event_id == event_id)
            )
        ).scalar()
        wave = EventWave(
            event_id=event_id,
            name=data.name.strip(),
            position=(last or 0) + 1,
            starts_at=data.starts_at,
            ends_at=data.ends_at,
        )
        self.session.add(wave)
        await self.session.flush()
        log.info("wave created", extra={"event_id": str(event_id), "wave_id": str(wave.id)})
        return wave

    async def update(self, event_id: UUID, wave_id: UUID, data: EventWaveUpdate) -> EventWave:
        ev = await self._event(event_id)
        wave = await self.get(event_id, wave_id)

        if data.name is not None:
            wave.name = data.name.strip()
        if data.starts_at is not None:
            wave.starts_at = data.starts_at
        if data.clear_ends_at:
            wave.ends_at = None
        elif data.ends_at is not None:
            wave.ends_at = data.ends_at
        self._check_window(ev, wave.starts_at, wave.ends_at)

        if data.position is not None and data.position != wave.position:
            await self._move(event_id, wave, data.position)

        await self.session.flush()
        return wave

    async def delete(self, event_id: UUID, wave_id: UUID) -> None:
        """Remove a wave. Its challenges survive and become unwaved."""
        wave = await self.get(event_id, wave_id)
        position = wave.position
        # The FK is ON DELETE SET NULL, but doing it explicitly keeps the
        # in-session objects correct for anything reading in the same request.
        await self.session.execute(
            update(EventChallenge)
            .where(EventChallenge.wave_id == wave_id)
            .values(wave_id=None)
        )
        await self.session.delete(wave)
        await self.session.flush()
        # Close the gap so positions stay 1..n.
        await self.session.execute(
            update(EventWave)
            .where(EventWave.event_id == event_id, EventWave.position > position)
            .values(position=EventWave.position - 1)
        )
        await self.session.flush()

    # -- helpers -------------------------------------------------------------

    @staticmethod
    def _check_window(ev: Event, starts_at: datetime, ends_at: datetime | None) -> None:
        if starts_at < ev.starts_at:
            raise AppError(
                ErrorCode.VALIDATION,
                "a wave cannot open before the event starts",
            )
        if starts_at >= ev.ends_at:
            raise AppError(
                ErrorCode.VALIDATION,
                "a wave cannot open at or after the event ends",
            )
        if ends_at is not None:
            if ends_at <= starts_at:
                raise AppError(ErrorCode.VALIDATION, "a wave must end after it starts")
            if ends_at > ev.ends_at:
                raise AppError(
                    ErrorCode.VALIDATION,
                    "a wave cannot outlast the event; leave the end empty to run to the finish",
                )

    async def _move(self, event_id: UUID, wave: EventWave, target: int) -> None:
        """Renumber so `wave` sits at `target`, keeping positions contiguous.

        The unique index on (event_id, position) means the rows cannot simply be
        rewritten in place, so the wave is parked on a free slot first.
        """
        total = (
            await self.session.execute(
                select(func.count()).select_from(EventWave).where(EventWave.event_id == event_id)
            )
        ).scalar() or 0
        target = max(1, min(target, total))
        if target == wave.position:
            return

        old = wave.position
        parking = total + 1000
        wave.position = parking
        await self.session.flush()

        if target < old:
            await self.session.execute(
                update(EventWave)
                .where(
                    EventWave.event_id == event_id,
                    EventWave.position >= target,
                    EventWave.position < old,
                )
                .values(position=EventWave.position + 1)
            )
        else:
            await self.session.execute(
                update(EventWave)
                .where(
                    EventWave.event_id == event_id,
                    EventWave.position > old,
                    EventWave.position <= target,
                )
                .values(position=EventWave.position - 1)
            )
        await self.session.flush()
        wave.position = target
        await self.session.flush()
