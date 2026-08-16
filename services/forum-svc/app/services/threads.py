"""Thread service: CRUD + lifecycle + listing."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, ErrorCode
from app.core.logging import get_logger
from app.models import Category, Post, Thread
from app.schemas import ThreadCreate, ThreadUpdate
from app.utils.slug import slugify, slugify_with_suffix

log = get_logger("threads")


class ThreadService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # =========================================================================
    # Reads
    # =========================================================================

    async def get(self, thread_id: UUID) -> Thread:
        result = await self.session.execute(select(Thread).where(Thread.id == thread_id))
        thread = result.scalar_one_or_none()
        if not thread or thread.deleted_at is not None:
            raise AppError(ErrorCode.THREAD_NOT_FOUND, "thread not found")
        return thread

    async def get_by_slug(self, slug: str) -> Thread:
        result = await self.session.execute(
            select(Thread).where(func.lower(Thread.slug) == slug.lower())
        )
        thread = result.scalar_one_or_none()
        if not thread or thread.deleted_at is not None:
            raise AppError(ErrorCode.THREAD_NOT_FOUND, "thread not found")
        return thread

    async def list_(
        self,
        *,
        category_id: UUID | None = None,
        tag: str | None = None,
        search: str | None = None,
        status: str | None = None,
        viewer_tier: str = "free",
        sort: str = "recent",  # recent|hot|top
        limit: int = 25,
        offset: int = 0,
    ) -> tuple[list[Thread], int]:
        stmt = select(Thread).where(Thread.deleted_at.is_(None))
        count_stmt = select(func.count()).select_from(Thread).where(Thread.deleted_at.is_(None))

        if category_id:
            stmt = stmt.where(Thread.category_id == category_id)
            count_stmt = count_stmt.where(Thread.category_id == category_id)

        # Filter by tier-accessible categories
        # (joining + tier filtering)
        stmt = stmt.join(Category, Category.id == Thread.category_id)
        count_stmt = count_stmt.join(Category, Category.id == Thread.category_id)
        if viewer_tier == "free":
            stmt = stmt.where(Category.required_tier == "free")
            count_stmt = count_stmt.where(Category.required_tier == "free")
        elif viewer_tier == "vip":
            stmt = stmt.where(Category.required_tier.in_(["free", "vip"]))
            count_stmt = count_stmt.where(Category.required_tier.in_(["free", "vip"]))

        if status:
            stmt = stmt.where(Thread.status == status)
            count_stmt = count_stmt.where(Thread.status == status)
        if tag:
            stmt = stmt.where(Thread.tags.any(tag))
            count_stmt = count_stmt.where(Thread.tags.any(tag))
        if search:
            pattern = f"%{search.lower()}%"
            stmt = stmt.where(func.lower(Thread.title).like(pattern))
            count_stmt = count_stmt.where(func.lower(Thread.title).like(pattern))

        # Sort
        if sort == "recent":
            stmt = stmt.order_by(
                Thread.is_pinned.desc(),
                Thread.last_post_at.desc(),
            )
        elif sort == "hot":
            # Activity-weighted (recent + replies)
            stmt = stmt.order_by(
                Thread.is_pinned.desc(),
                Thread.reply_count.desc(),
                Thread.last_post_at.desc(),
            )
        elif sort == "top":
            stmt = stmt.order_by(
                Thread.is_pinned.desc(),
                Thread.view_count.desc(),
                Thread.last_post_at.desc(),
            )

        total = (await self.session.execute(count_stmt)).scalar_one()
        result = await self.session.execute(stmt.limit(limit).offset(offset))
        return list(result.scalars().all()), int(total)

    # =========================================================================
    # Create
    # =========================================================================

    async def create(self, *, author_id: UUID, data: ThreadCreate) -> tuple[Thread, Post]:
        # Verify category accepts posts
        cat_result = await self.session.execute(
            select(Category).where(Category.id == data.category_id)
        )
        category = cat_result.scalar_one_or_none()
        if not category:
            raise AppError(ErrorCode.CATEGORY_NOT_FOUND, "category not found")
        if category.is_locked:
            raise AppError(ErrorCode.CATEGORY_LOCKED, "category is locked")

        # Try clean slug first, then collision suffix
        slug = slugify(data.title)
        thread = Thread(
            category_id=data.category_id,
            author_id=author_id,
            title=data.title,
            slug=slug,
            status="open",
            tags=data.tags,
            related_machine_id=data.related_machine_id,
            related_challenge_id=data.related_challenge_id,
        )
        self.session.add(thread)
        try:
            await self.session.flush()
        except IntegrityError:
            await self.session.rollback()
            # Slug collision: retry with suffix
            slug = slugify_with_suffix(data.title)
            thread = Thread(
                category_id=data.category_id,
                author_id=author_id,
                title=data.title,
                slug=slug,
                status="open",
                tags=data.tags,
                related_machine_id=data.related_machine_id,
                related_challenge_id=data.related_challenge_id,
            )
            self.session.add(thread)
            await self.session.flush()

        # First post (the OP)
        first_post = Post(
            thread_id=thread.id,
            author_id=author_id,
            content_markdown=data.body_markdown,
            is_first_post=True,
            contains_spoilers=data.contains_spoilers,
        )
        self.session.add(first_post)
        await self.session.flush()

        # Update category thread_count
        await self.session.execute(
            Category.__table__.update()
            .where(Category.id == data.category_id)
            .values(thread_count=Category.thread_count + 1)
        )

        # Update thread denormalized fields
        await self.session.execute(
            Thread.__table__.update()
            .where(Thread.id == thread.id)
            .values(
                last_post_at=datetime.now(timezone.utc),
                last_post_user_id=author_id,
            )
        )
        await self.session.flush()

        log.info(
            "thread_created",
            thread_id=str(thread.id),
            slug=thread.slug,
            author=str(author_id),
        )
        return thread, first_post

    # =========================================================================
    # Update
    # =========================================================================

    async def update(
        self,
        thread_id: UUID,
        *,
        actor_id: UUID,
        is_moderator: bool,
        data: ThreadUpdate,
    ) -> Thread:
        thread = await self.get(thread_id)
        if not is_moderator and thread.author_id != actor_id:
            raise AppError(ErrorCode.NOT_AUTHOR, "you can only edit your own threads")
        if thread.status in ("locked", "archived"):
            raise AppError(ErrorCode.THREAD_LOCKED, "thread is locked")

        body = data.model_dump(exclude_unset=True)
        for k, v in body.items():
            setattr(thread, k, v)
        thread.updated_at = datetime.now(timezone.utc)
        await self.session.flush()
        return thread

    # =========================================================================
    # Moderation actions
    # =========================================================================

    async def set_status(
        self, thread_id: UUID, *, new_status: str, actor_id: UUID, is_moderator: bool
    ) -> Thread:
        thread = await self.get(thread_id)
        # Authors can close their own thread; only mods can lock/archive
        if new_status in ("locked", "archived") and not is_moderator:
            raise AppError(ErrorCode.NOT_MODERATOR, "moderator required")
        if new_status == "closed" and thread.author_id != actor_id and not is_moderator:
            raise AppError(ErrorCode.NOT_AUTHOR, "only author or mod can close")
        thread.status = new_status
        await self.session.flush()
        log.info(
            "thread_status_changed",
            thread_id=str(thread_id),
            status=new_status,
            actor=str(actor_id),
        )
        return thread

    async def set_pinned(
        self, thread_id: UUID, *, pinned: bool, is_moderator: bool
    ) -> Thread:
        if not is_moderator:
            raise AppError(ErrorCode.NOT_MODERATOR, "moderator required")
        thread = await self.get(thread_id)
        thread.is_pinned = pinned
        await self.session.flush()
        return thread

    async def mark_solved(
        self,
        thread_id: UUID,
        *,
        solved_post_id: UUID | None,
        actor_id: UUID,
        is_moderator: bool,
    ) -> Thread:
        thread = await self.get(thread_id)
        if thread.author_id != actor_id and not is_moderator:
            raise AppError(
                ErrorCode.NOT_AUTHOR,
                "only the thread author or a moderator can mark solved",
            )
        # Verify the post exists in this thread
        if solved_post_id:
            post_result = await self.session.execute(
                select(Post.id).where(
                    and_(Post.id == solved_post_id, Post.thread_id == thread_id)
                )
            )
            if post_result.scalar_one_or_none() is None:
                raise AppError(ErrorCode.POST_NOT_FOUND, "post not in this thread")
        thread.is_solved = solved_post_id is not None
        thread.solved_post_id = solved_post_id
        await self.session.flush()
        return thread

    async def soft_delete(
        self, thread_id: UUID, *, actor_id: UUID, is_moderator: bool
    ) -> None:
        thread = await self.get(thread_id)
        if thread.author_id != actor_id and not is_moderator:
            raise AppError(ErrorCode.NOT_AUTHOR, "only author or mod can delete")
        thread.deleted_at = datetime.now(timezone.utc)
        thread.status = "deleted"
        await self.session.flush()
        await self.session.execute(
            Category.__table__.update()
            .where(Category.id == thread.category_id)
            .values(thread_count=Category.thread_count - 1)
        )
        await self.session.flush()
        log.info("thread_deleted", thread_id=str(thread_id), actor=str(actor_id))

    # =========================================================================
    # View tracking
    # =========================================================================

    async def increment_view(self, thread_id: UUID) -> None:
        """Best-effort increment (called by API on GET).

        In production we batch this through Redis to avoid write amplification.
        """
        await self.session.execute(
            Thread.__table__.update()
            .where(Thread.id == thread_id)
            .values(view_count=Thread.view_count + 1)
        )
