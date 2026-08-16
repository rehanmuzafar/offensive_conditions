"""Announcement service: organizer broadcasts."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, ErrorCode
from app.core.logging import get_logger
from app.models import Event, EventAnnouncement
from app.schemas import AnnouncementCreate

log = get_logger("announcements")


class AnnouncementService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def post(
        self, event_id: UUID, *, poster_id: UUID, data: AnnouncementCreate
    ) -> EventAnnouncement:
        event_result = await self.session.execute(select(Event).where(Event.id == event_id))
        if event_result.scalar_one_or_none() is None:
            raise AppError(ErrorCode.EVENT_NOT_FOUND, "event not found")

        announcement = EventAnnouncement(
            event_id=event_id,
            posted_by=poster_id,
            title=data.title,
            body=data.body,
            is_pinned=data.is_pinned,
            challenge_id=data.challenge_id,
        )
        self.session.add(announcement)
        await self.session.flush()
        log.info("announcement_posted", event_id=str(event_id), announcement_id=str(announcement.id))
        return announcement

    async def list_(
        self, event_id: UUID, *, limit: int = 50, offset: int = 0
    ) -> tuple[list[EventAnnouncement], int]:
        stmt = (
            select(EventAnnouncement)
            .where(EventAnnouncement.event_id == event_id)
            .order_by(
                EventAnnouncement.is_pinned.desc(),
                EventAnnouncement.created_at.desc(),
            )
        )
        count_stmt = (
            select(func.count())
            .select_from(EventAnnouncement)
            .where(EventAnnouncement.event_id == event_id)
        )
        total = (await self.session.execute(count_stmt)).scalar_one()
        result = await self.session.execute(stmt.limit(limit).offset(offset))
        return list(result.scalars().all()), int(total)
