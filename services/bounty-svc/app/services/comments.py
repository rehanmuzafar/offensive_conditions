"""Comment service for bounty reports."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, ErrorCode
from app.core.logging import get_logger
from app.models import Report, ReportComment
from app.schemas import CommentCreate
from app.utils.markdown import render_safe_html

log = get_logger("comments")


class CommentService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list_for_report(
        self,
        report_id: UUID,
        *,
        include_internal: bool,
        limit: int = 100,
        offset: int = 0,
    ) -> tuple[list[ReportComment], int]:
        stmt = (
            select(ReportComment)
            .where(
                ReportComment.report_id == report_id,
                ReportComment.deleted_at.is_(None),
            )
        )
        count_stmt = (
            select(func.count())
            .select_from(ReportComment)
            .where(
                ReportComment.report_id == report_id,
                ReportComment.deleted_at.is_(None),
            )
        )
        if not include_internal:
            stmt = stmt.where(ReportComment.visibility == "public")
            count_stmt = count_stmt.where(ReportComment.visibility == "public")
        stmt = stmt.order_by(ReportComment.created_at.asc())
        total = (await self.session.execute(count_stmt)).scalar_one()
        result = await self.session.execute(stmt.limit(limit).offset(offset))
        return list(result.scalars().all()), int(total)

    async def add(
        self,
        report_id: UUID,
        *,
        author_id: UUID,
        author_role: str,
        data: CommentCreate,
    ) -> ReportComment:
        # Validate report exists
        report_result = await self.session.execute(
            select(Report.id).where(Report.id == report_id)
        )
        if report_result.scalar_one_or_none() is None:
            raise AppError(ErrorCode.REPORT_NOT_FOUND, "report not found")

        # Researchers can't post internal comments
        if data.visibility == "internal" and author_role == "researcher":
            raise AppError(
                ErrorCode.FORBIDDEN,
                "researchers cannot post internal comments",
            )

        html = render_safe_html(data.body_md)
        comment = ReportComment(
            report_id=report_id,
            author_id=author_id,
            author_role=author_role,
            visibility=data.visibility,
            body_md=data.body_md,
            body_html=html,
        )
        self.session.add(comment)
        await self.session.flush()
        log.info(
            "report_comment_added",
            comment_id=str(comment.id),
            report_id=str(report_id),
            author=str(author_id),
            role=author_role,
            visibility=data.visibility,
        )
        return comment

    async def add_system_event(
        self,
        report_id: UUID,
        *,
        body_md: str,
        visibility: str = "public",
    ) -> ReportComment:
        """Insert a system-generated comment (state changes, payouts, etc).

        These are visible in the thread but tagged so the UI can render them
        as activity-feed items, not user messages.
        """
        comment = ReportComment(
            report_id=report_id,
            author_id=UUID("00000000-0000-0000-0000-000000000000"),
            author_role="system",
            visibility=visibility,
            body_md=body_md,
            body_html=render_safe_html(body_md),
            is_state_change=True,
        )
        self.session.add(comment)
        await self.session.flush()
        return comment

    async def soft_delete(
        self, comment_id: UUID, *, actor_id: UUID, is_moderator: bool
    ) -> None:
        result = await self.session.execute(
            select(ReportComment).where(ReportComment.id == comment_id)
        )
        comment = result.scalar_one_or_none()
        if not comment or comment.deleted_at is not None:
            raise AppError(ErrorCode.NOT_FOUND, "comment not found")
        if not is_moderator and comment.author_id != actor_id:
            raise AppError(ErrorCode.FORBIDDEN, "only author or mod can delete")
        comment.deleted_at = datetime.now(timezone.utc)
        await self.session.flush()
