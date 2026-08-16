"""Subscription + report services."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, ErrorCode
from app.core.logging import get_logger
from app.models import Report, Thread, ThreadSubscription
from app.schemas import ReportCreate, SubscriptionToggle

log = get_logger("subscriptions")


class SubscriptionService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def subscribe(
        self, thread_id: UUID, *, user_id: UUID, prefs: SubscriptionToggle
    ) -> ThreadSubscription:
        # Verify thread exists
        thread_result = await self.session.execute(
            select(Thread.id).where(
                and_(Thread.id == thread_id, Thread.deleted_at.is_(None))
            )
        )
        if thread_result.scalar_one_or_none() is None:
            raise AppError(ErrorCode.THREAD_NOT_FOUND, "thread not found")

        # Upsert
        existing = await self.session.execute(
            select(ThreadSubscription).where(
                and_(
                    ThreadSubscription.thread_id == thread_id,
                    ThreadSubscription.user_id == user_id,
                )
            )
        )
        sub = existing.scalar_one_or_none()
        if sub:
            sub.email_notifications = prefs.email_notifications
            sub.in_app_notifications = prefs.in_app_notifications
        else:
            sub = ThreadSubscription(
                thread_id=thread_id,
                user_id=user_id,
                email_notifications=prefs.email_notifications,
                in_app_notifications=prefs.in_app_notifications,
            )
            self.session.add(sub)
            try:
                await self.session.flush()
            except IntegrityError:
                await self.session.rollback()
                raise AppError(ErrorCode.ALREADY_SUBSCRIBED, "already subscribed")
        await self.session.flush()
        return sub

    async def unsubscribe(self, thread_id: UUID, *, user_id: UUID) -> None:
        result = await self.session.execute(
            select(ThreadSubscription).where(
                and_(
                    ThreadSubscription.thread_id == thread_id,
                    ThreadSubscription.user_id == user_id,
                )
            )
        )
        sub = result.scalar_one_or_none()
        if not sub:
            raise AppError(ErrorCode.NOT_SUBSCRIBED, "not subscribed")
        await self.session.delete(sub)
        await self.session.flush()

    async def list_my(self, user_id: UUID, *, limit: int = 25, offset: int = 0) -> tuple[list, int]:
        stmt = (
            select(ThreadSubscription)
            .where(ThreadSubscription.user_id == user_id)
            .order_by(ThreadSubscription.subscribed_at.desc())
        )
        count_stmt = (
            select(func.count())
            .select_from(ThreadSubscription)
            .where(ThreadSubscription.user_id == user_id)
        )
        total = (await self.session.execute(count_stmt)).scalar_one()
        result = await self.session.execute(stmt.limit(limit).offset(offset))
        return list(result.scalars().all()), int(total)


class ReportService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def file_report(self, *, reporter_id: UUID, data: ReportCreate) -> Report:
        # Prevent duplicate open reports from the same reporter
        existing = await self.session.execute(
            select(Report).where(
                and_(
                    Report.reporter_id == reporter_id,
                    Report.target_type == data.target_type,
                    Report.target_id == data.target_id,
                    Report.status.in_(["open", "reviewing"]),
                )
            )
        )
        if existing.scalar_one_or_none() is not None:
            raise AppError(
                ErrorCode.REPORT_ALREADY_FILED,
                "you already have an open report against this target",
            )

        report = Report(
            reporter_id=reporter_id,
            target_type=data.target_type,
            target_id=data.target_id,
            reason=data.reason,
            details=data.details,
            status="open",
        )
        self.session.add(report)
        await self.session.flush()
        log.info(
            "report_filed",
            report_id=str(report.id),
            target_type=data.target_type,
            target_id=str(data.target_id),
            reason=data.reason,
        )
        return report

    async def list_open(
        self, *, status: str | None = None, limit: int = 25, offset: int = 0
    ) -> tuple[list[Report], int]:
        stmt = select(Report).order_by(Report.created_at.desc())
        count_stmt = select(func.count()).select_from(Report)
        if status:
            stmt = stmt.where(Report.status == status)
            count_stmt = count_stmt.where(Report.status == status)
        else:
            stmt = stmt.where(Report.status.in_(["open", "reviewing"]))
            count_stmt = count_stmt.where(Report.status.in_(["open", "reviewing"]))
        total = (await self.session.execute(count_stmt)).scalar_one()
        result = await self.session.execute(stmt.limit(limit).offset(offset))
        return list(result.scalars().all()), int(total)

    async def resolve(
        self,
        report_id: UUID,
        *,
        resolver_id: UUID,
        action: str,
        note: str | None,
    ) -> Report:
        result = await self.session.execute(
            select(Report).where(Report.id == report_id)
        )
        report = result.scalar_one_or_none()
        if not report:
            raise AppError(ErrorCode.NOT_FOUND, "report not found")
        report.status = "resolved" if action != "dismiss" else "dismissed"
        report.resolved_by = resolver_id
        report.resolution_note = note or action
        report.resolved_at = datetime.now(timezone.utc)
        await self.session.flush()
        log.info(
            "report_resolved",
            report_id=str(report_id),
            action=action,
            resolver=str(resolver_id),
        )
        return report
