"""Comment service for writeups."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, ErrorCode
from app.core.logging import get_logger
from app.models import Comment, Writeup
from app.schemas import CommentCreate, CommentUpdate
from app.utils.markdown import render_safe_html

log = get_logger("comments")

_EDIT_GRACE_PERIOD = timedelta(minutes=5)


class CommentService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(self, comment_id: UUID) -> Comment:
        result = await self.session.execute(
            select(Comment).where(Comment.id == comment_id)
        )
        c = result.scalar_one_or_none()
        if not c or c.is_deleted:
            raise AppError(ErrorCode.COMMENT_NOT_FOUND, "comment not found")
        return c

    async def list_for_writeup(
        self,
        writeup_id: UUID,
        *,
        limit: int = 25,
        offset: int = 0,
        include_deleted: bool = False,
    ) -> tuple[list[Comment], int]:
        stmt = (
            select(Comment)
            .where(Comment.writeup_id == writeup_id)
            .order_by(Comment.created_at.asc())
        )
        count_stmt = (
            select(func.count())
            .select_from(Comment)
            .where(Comment.writeup_id == writeup_id)
        )
        if not include_deleted:
            stmt = stmt.where(Comment.is_deleted.is_(False))
            count_stmt = count_stmt.where(Comment.is_deleted.is_(False))

        total = (await self.session.execute(count_stmt)).scalar_one()
        result = await self.session.execute(stmt.limit(limit).offset(offset))
        return list(result.scalars().all()), int(total)

    async def create(
        self, writeup_id: UUID, *, author_id: UUID, data: CommentCreate
    ) -> Comment:
        # Writeup must exist and be approved (or author commenting on own draft)
        wr_result = await self.session.execute(
            select(Writeup).where(Writeup.id == writeup_id)
        )
        writeup = wr_result.scalar_one_or_none()
        if not writeup or writeup.deleted_at is not None:
            raise AppError(ErrorCode.WRITEUP_NOT_FOUND, "writeup not found")
        if writeup.status != "approved" and writeup.author_id != author_id:
            raise AppError(
                ErrorCode.FORBIDDEN, "writeup not yet approved for comments"
            )

        # Validate parent_comment_id if given
        if data.parent_comment_id:
            parent_result = await self.session.execute(
                select(Comment.id).where(
                    and_(
                        Comment.id == data.parent_comment_id,
                        Comment.writeup_id == writeup_id,
                    )
                )
            )
            if parent_result.scalar_one_or_none() is None:
                raise AppError(
                    ErrorCode.COMMENT_NOT_FOUND, "parent comment not in this writeup"
                )

        html_cache = render_safe_html(data.content_markdown)
        comment = Comment(
            writeup_id=writeup_id,
            author_id=author_id,
            parent_comment_id=data.parent_comment_id,
            content_markdown=data.content_markdown,
            content_html=html_cache,
        )
        self.session.add(comment)
        await self.session.flush()

        # Update writeup comment_count
        await self.session.execute(
            Writeup.__table__.update()
            .where(Writeup.id == writeup_id)
            .values(comment_count=Writeup.comment_count + 1)
        )
        await self.session.flush()
        log.info(
            "comment_created",
            comment_id=str(comment.id),
            writeup_id=str(writeup_id),
            author=str(author_id),
        )
        return comment

    async def update(
        self,
        comment_id: UUID,
        *,
        actor_id: UUID,
        is_moderator: bool,
        data: CommentUpdate,
    ) -> Comment:
        comment = await self.get(comment_id)
        if not is_moderator and comment.author_id != actor_id:
            raise AppError(ErrorCode.NOT_AUTHOR, "you can only edit your own comments")
        comment.content_markdown = data.content_markdown
        comment.content_html = render_safe_html(data.content_markdown)
        now = datetime.now(timezone.utc)
        if (now - comment.created_at) > _EDIT_GRACE_PERIOD:
            comment.is_edited = True
            comment.edit_count = comment.edit_count + 1
            comment.edited_at = now
            comment.edited_by = actor_id
        await self.session.flush()
        return comment

    async def soft_delete(
        self, comment_id: UUID, *, actor_id: UUID, is_moderator: bool
    ) -> None:
        comment = await self.get(comment_id)
        if not is_moderator and comment.author_id != actor_id:
            raise AppError(ErrorCode.NOT_AUTHOR, "only author or mod can delete")
        comment.is_deleted = True
        comment.deleted_at = datetime.now(timezone.utc)
        comment.deleted_by = actor_id
        await self.session.flush()
        # Decrement writeup comment_count
        await self.session.execute(
            Writeup.__table__.update()
            .where(Writeup.id == comment.writeup_id)
            .values(comment_count=Writeup.comment_count - 1)
        )
        await self.session.flush()
        log.info(
            "comment_deleted", comment_id=str(comment_id), actor=str(actor_id)
        )
