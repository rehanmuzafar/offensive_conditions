"""Post service: replies, edits, deletes, mention extraction."""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, ErrorCode
from app.core.logging import get_logger
from app.models import Post, Thread
from app.schemas import PostCreate, PostUpdate
from app.utils.markdown import render_safe_html

log = get_logger("posts")


_MENTION_RE = re.compile(r"(?<![A-Za-z0-9_])@([A-Za-z0-9_]{3,32})")


# Authors can edit within this window without flagging "edited" in the UI;
# beyond this, posts show "edited" indicator. Forum convention.
_EDIT_GRACE_PERIOD = timedelta(minutes=5)


class PostService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(self, post_id: UUID) -> Post:
        result = await self.session.execute(select(Post).where(Post.id == post_id))
        post = result.scalar_one_or_none()
        if not post or post.is_deleted:
            raise AppError(ErrorCode.POST_NOT_FOUND, "post not found")
        return post

    async def list_for_thread(
        self,
        thread_id: UUID,
        *,
        limit: int = 25,
        offset: int = 0,
        include_deleted: bool = False,
    ) -> tuple[list[Post], int]:
        stmt = (
            select(Post)
            .where(Post.thread_id == thread_id)
            .order_by(
                Post.is_first_post.desc(),
                Post.is_pinned.desc(),
                Post.created_at.asc(),
            )
        )
        count_stmt = (
            select(func.count())
            .select_from(Post)
            .where(Post.thread_id == thread_id)
        )
        if not include_deleted:
            stmt = stmt.where(Post.is_deleted.is_(False))
            count_stmt = count_stmt.where(Post.is_deleted.is_(False))

        total = (await self.session.execute(count_stmt)).scalar_one()
        result = await self.session.execute(stmt.limit(limit).offset(offset))
        return list(result.scalars().all()), int(total)

    async def create_reply(
        self,
        thread_id: UUID,
        *,
        author_id: UUID,
        data: PostCreate,
    ) -> Post:
        # Verify thread accepts replies
        thread_result = await self.session.execute(
            select(Thread).where(Thread.id == thread_id)
        )
        thread = thread_result.scalar_one_or_none()
        if not thread or thread.deleted_at is not None:
            raise AppError(ErrorCode.THREAD_NOT_FOUND, "thread not found")
        if thread.status in ("locked", "archived", "deleted"):
            raise AppError(ErrorCode.THREAD_LOCKED, "thread is locked")
        if thread.status == "closed":
            raise AppError(ErrorCode.THREAD_CLOSED, "thread is closed")

        # Validate parent_post_id if given
        if data.parent_post_id:
            parent_result = await self.session.execute(
                select(Post.id).where(
                    and_(Post.id == data.parent_post_id, Post.thread_id == thread_id)
                )
            )
            if parent_result.scalar_one_or_none() is None:
                raise AppError(ErrorCode.POST_NOT_FOUND, "parent post not in this thread")

        # Extract @mentions
        mentions = self._extract_mention_ids(data.content_markdown)

        # Pre-render HTML
        html_cache = render_safe_html(data.content_markdown)

        post = Post(
            thread_id=thread_id,
            author_id=author_id,
            parent_post_id=data.parent_post_id,
            content_markdown=data.content_markdown,
            content_html=html_cache,
            contains_spoilers=data.contains_spoilers,
            mentioned_users=mentions,
        )
        self.session.add(post)
        await self.session.flush()

        # Update thread stats
        await self._refresh_thread_stats(thread_id, last_user=author_id)

        log.info(
            "post_created",
            post_id=str(post.id),
            thread_id=str(thread_id),
            author=str(author_id),
        )
        return post

    async def update(
        self,
        post_id: UUID,
        *,
        actor_id: UUID,
        is_moderator: bool,
        data: PostUpdate,
    ) -> Post:
        post = await self.get(post_id)
        if not is_moderator and post.author_id != actor_id:
            raise AppError(ErrorCode.NOT_AUTHOR, "you can only edit your own posts")

        post.content_markdown = data.content_markdown
        post.content_html = render_safe_html(data.content_markdown)
        if data.contains_spoilers is not None:
            post.contains_spoilers = data.contains_spoilers

        # Mark edited if outside grace period
        now = datetime.now(timezone.utc)
        if (now - post.created_at) > _EDIT_GRACE_PERIOD:
            post.is_edited = True
            post.edit_count = post.edit_count + 1
            post.edited_at = now
            post.edited_by = actor_id

        # Refresh mentions
        post.mentioned_users = self._extract_mention_ids(data.content_markdown)
        await self.session.flush()
        log.info("post_edited", post_id=str(post_id), actor=str(actor_id))
        return post

    async def soft_delete(
        self, post_id: UUID, *, actor_id: UUID, is_moderator: bool
    ) -> None:
        post = await self.get(post_id)
        if not is_moderator and post.author_id != actor_id:
            raise AppError(ErrorCode.NOT_AUTHOR, "you can only delete your own posts")
        if post.is_first_post:
            raise AppError(
                ErrorCode.FORBIDDEN,
                "delete the thread instead of the first post",
            )
        post.is_deleted = True
        post.deleted_at = datetime.now(timezone.utc)
        post.deleted_by = actor_id
        await self.session.flush()
        await self._refresh_thread_stats(post.thread_id, last_user=None)
        log.info(
            "post_deleted", post_id=str(post_id), actor=str(actor_id), is_mod=is_moderator
        )

    # =========================================================================
    # Helpers
    # =========================================================================

    def _extract_mention_ids(self, _markdown: str) -> list[UUID]:
        """Extract user mentions from markdown.

        We extract @handles in the API gateway / event consumer that resolves
        handles → user IDs via user-svc. Here we return empty until that wiring
        lands; the column is still populated then for notifications.
        """
        # _MENTION_RE.findall(_markdown) returns handles for downstream resolution.
        # In a fuller implementation we'd call user-svc.BatchResolveByHandle.
        return []

    async def _refresh_thread_stats(
        self, thread_id: UUID, *, last_user: UUID | None
    ) -> None:
        """Recompute reply_count + unique_posters + last_post_at."""
        result = await self.session.execute(
            select(
                func.count(Post.id).filter(Post.is_first_post.is_(False)),
                func.count(func.distinct(Post.author_id)),
                func.max(Post.created_at),
            ).where(
                and_(Post.thread_id == thread_id, Post.is_deleted.is_(False))
            )
        )
        reply_count, unique_posters, last_post_at = result.one()
        values: dict = {
            "reply_count": int(reply_count or 0),
            "unique_posters": int(unique_posters or 0),
        }
        if last_post_at:
            values["last_post_at"] = last_post_at
        if last_user is not None:
            values["last_post_user_id"] = last_user
        await self.session.execute(
            Thread.__table__.update().where(Thread.id == thread_id).values(**values)
        )
