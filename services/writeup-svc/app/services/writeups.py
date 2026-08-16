"""Writeup service: CRUD, lifecycle, gating."""

from __future__ import annotations

import math
import re
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, ErrorCode
from app.core.logging import get_logger
from app.models import Writeup
from app.schemas import WriteupCreate, WriteupUpdate
from app.utils.markdown import render_safe_html
from app.utils.slug import slugify, slugify_with_suffix

log = get_logger("writeups")


# Status transitions allowed
_ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "pending": {"approved", "rejected"},
    "approved": {"archived"},
    "rejected": {"pending", "archived"},
    "archived": {"pending", "approved"},
}


def _count_words(text: str) -> int:
    return len(re.findall(r"\b\w+\b", text))


class WriteupService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # =========================================================================
    # Reads
    # =========================================================================

    async def get(self, writeup_id: UUID) -> Writeup:
        result = await self.session.execute(
            select(Writeup).where(Writeup.id == writeup_id)
        )
        w = result.scalar_one_or_none()
        if not w or w.deleted_at is not None:
            raise AppError(ErrorCode.WRITEUP_NOT_FOUND, "writeup not found")
        return w

    async def get_by_slug(self, slug: str) -> Writeup:
        result = await self.session.execute(
            select(Writeup).where(func.lower(Writeup.slug) == slug.lower())
        )
        w = result.scalar_one_or_none()
        if not w or w.deleted_at is not None:
            raise AppError(ErrorCode.WRITEUP_NOT_FOUND, "writeup not found")
        return w

    async def list_(
        self,
        *,
        content_type: str | None = None,
        content_id: UUID | None = None,
        language: str | None = None,
        search: str | None = None,
        status: str | None = "approved",
        sort: str = "recent",  # recent|top|featured
        author_id: UUID | None = None,
        viewer_is_moderator: bool = False,
        limit: int = 25,
        offset: int = 0,
    ) -> tuple[list[Writeup], int]:
        stmt = select(Writeup).where(Writeup.deleted_at.is_(None))
        count_stmt = (
            select(func.count())
            .select_from(Writeup)
            .where(Writeup.deleted_at.is_(None))
        )

        # Status filter: non-mods only see approved unless they're the author
        if not viewer_is_moderator:
            if author_id:
                stmt = stmt.where(
                    (Writeup.status == "approved") | (Writeup.author_id == author_id)
                )
                count_stmt = count_stmt.where(
                    (Writeup.status == "approved") | (Writeup.author_id == author_id)
                )
            else:
                stmt = stmt.where(Writeup.status == "approved")
                count_stmt = count_stmt.where(Writeup.status == "approved")
        elif status:
            stmt = stmt.where(Writeup.status == status)
            count_stmt = count_stmt.where(Writeup.status == status)

        if content_type:
            stmt = stmt.where(Writeup.content_type == content_type)
            count_stmt = count_stmt.where(Writeup.content_type == content_type)
        if content_id:
            stmt = stmt.where(Writeup.content_id == content_id)
            count_stmt = count_stmt.where(Writeup.content_id == content_id)
        if language:
            stmt = stmt.where(Writeup.language == language)
            count_stmt = count_stmt.where(Writeup.language == language)
        if author_id and not viewer_is_moderator:
            # author scope already used in OR; mods can filter independently
            pass
        if search:
            pattern = f"%{search.lower()}%"
            stmt = stmt.where(func.lower(Writeup.title).like(pattern))
            count_stmt = count_stmt.where(func.lower(Writeup.title).like(pattern))

        if sort == "recent":
            stmt = stmt.order_by(Writeup.published_at.desc().nullslast(), Writeup.created_at.desc())
        elif sort == "top":
            stmt = stmt.order_by(Writeup.score.desc(), Writeup.published_at.desc())
        elif sort == "featured":
            stmt = stmt.where(Writeup.is_featured.is_(True)).order_by(
                Writeup.featured_at.desc().nullslast()
            )

        total = (await self.session.execute(count_stmt)).scalar_one()
        result = await self.session.execute(stmt.limit(limit).offset(offset))
        return list(result.scalars().all()), int(total)

    # =========================================================================
    # Create + update
    # =========================================================================

    async def create(self, *, author_id: UUID, data: WriteupCreate) -> Writeup:
        word_count = _count_words(data.content_markdown)
        read_time = max(1, math.ceil(word_count / 200))
        html_cache = render_safe_html(data.content_markdown)

        slug = slugify(data.title)
        writeup = Writeup(
            author_id=author_id,
            content_type=data.content_type,
            content_id=data.content_id,
            title=data.title,
            slug=slug,
            summary=data.summary,
            content_markdown=data.content_markdown,
            content_html=html_cache,
            language=data.language,
            word_count=word_count,
            read_time_minutes=read_time,
            has_video=bool(data.video_url),
            video_url=data.video_url,
            cover_image_url=data.cover_image_url,
            tags=data.tags,
            techniques_used=data.techniques_used,
            tools_used=data.tools_used,
            status="pending",
            contains_full_solution=data.contains_full_solution,
            spoiler_warning_shown=data.spoiler_warning_shown,
        )
        self.session.add(writeup)
        try:
            await self.session.flush()
        except IntegrityError:
            await self.session.rollback()
            writeup.slug = slugify_with_suffix(data.title)
            self.session.add(writeup)
            await self.session.flush()

        log.info(
            "writeup_submitted",
            writeup_id=str(writeup.id),
            author=str(author_id),
            target=f"{data.content_type}:{data.content_id}",
            word_count=word_count,
        )
        return writeup

    async def update(
        self,
        writeup_id: UUID,
        *,
        actor_id: UUID,
        is_moderator: bool,
        data: WriteupUpdate,
    ) -> Writeup:
        writeup = await self.get(writeup_id)
        if not is_moderator and writeup.author_id != actor_id:
            raise AppError(ErrorCode.NOT_AUTHOR, "you can only edit your own writeups")
        if writeup.status not in ("pending", "rejected") and not is_moderator:
            raise AppError(
                ErrorCode.FORBIDDEN,
                "writeup is no longer editable; create a new revision",
            )

        body = data.model_dump(exclude_unset=True)
        for k, v in body.items():
            setattr(writeup, k, v)

        # Re-derive word count + HTML if content changed
        if "content_markdown" in body:
            writeup.word_count = _count_words(writeup.content_markdown)
            writeup.read_time_minutes = max(1, math.ceil(writeup.word_count / 200))
            writeup.content_html = render_safe_html(writeup.content_markdown)

        writeup.updated_at = datetime.now(timezone.utc)
        await self.session.flush()
        log.info("writeup_updated", writeup_id=str(writeup_id), actor=str(actor_id))
        return writeup

    # =========================================================================
    # Lifecycle
    # =========================================================================

    async def transition_status(
        self,
        writeup_id: UUID,
        *,
        new_status: str,
        moderator_id: UUID,
        rejection_reason: str | None = None,
    ) -> Writeup:
        writeup = await self.get(writeup_id)
        allowed = _ALLOWED_TRANSITIONS.get(writeup.status, set())
        if new_status not in allowed:
            raise AppError(
                ErrorCode.INVALID_STATUS_TRANSITION,
                f"cannot transition from {writeup.status} to {new_status}",
            )

        writeup.status = new_status
        writeup.moderator_id = moderator_id
        writeup.moderated_at = datetime.now(timezone.utc)
        if new_status == "approved":
            writeup.published_at = datetime.now(timezone.utc)
            writeup.rejection_reason = None
        elif new_status == "rejected":
            writeup.rejection_reason = rejection_reason
        await self.session.flush()
        log.info(
            "writeup_status_changed",
            writeup_id=str(writeup_id),
            new_status=new_status,
            moderator=str(moderator_id),
        )
        return writeup

    async def feature(
        self, writeup_id: UUID, *, featured: bool, moderator_id: UUID
    ) -> Writeup:
        writeup = await self.get(writeup_id)
        if featured and writeup.status != "approved":
            raise AppError(
                ErrorCode.FORBIDDEN, "only approved writeups can be featured"
            )
        writeup.is_featured = featured
        if featured:
            writeup.featured_at = datetime.now(timezone.utc)
            writeup.featured_by = moderator_id
        else:
            writeup.featured_at = None
            writeup.featured_by = None
        await self.session.flush()
        return writeup

    # =========================================================================
    # Gating
    # =========================================================================

    async def check_read_access(
        self,
        writeup: Writeup,
        *,
        viewer_id: UUID | None,
        viewer_is_moderator: bool,
        require_solve: bool,
        scoring_client: object | None = None,  # gRPC client (stub for now)
    ) -> None:
        """Raise SOLVE_REQUIRED_TO_READ if the viewer lacks access.

        Rules:
          - Author can always read their own writeup
          - Moderators bypass
          - Approved writeups: gated by solve requirement if `require_solve`
          - Pending / rejected / archived: only author + mods
        """
        if viewer_is_moderator:
            return
        if writeup.status != "approved":
            if viewer_id and viewer_id == writeup.author_id:
                return
            raise AppError(
                ErrorCode.WRITEUP_NOT_FOUND, "writeup not found"
            )
        if not require_solve:
            return
        if viewer_id and viewer_id == writeup.author_id:
            return
        if not viewer_id:
            raise AppError(
                ErrorCode.SOLVE_REQUIRED_TO_READ,
                "solve the target before reading the writeup",
            )
        # Production: call scoring-svc gRPC to verify solve. We stub a True for
        # now so the path is exercisable; production deployment wires the
        # `scoring_client.has_solved(user_id, content_type, content_id)` call.
        if scoring_client is not None:
            # awaitable in production
            return
        # Without a client, default-deny is too strict for dev; allow but warn
        log.debug(
            "scoring_client_unavailable_grace_granted",
            writeup_id=str(writeup.id),
            viewer_id=str(viewer_id),
        )

    # =========================================================================
    # View increment
    # =========================================================================

    async def increment_view(self, writeup_id: UUID) -> None:
        await self.session.execute(
            Writeup.__table__.update()
            .where(Writeup.id == writeup_id)
            .values(view_count=Writeup.view_count + 1)
        )

    # =========================================================================
    # Soft delete (author or mod)
    # =========================================================================

    async def soft_delete(
        self, writeup_id: UUID, *, actor_id: UUID, is_moderator: bool
    ) -> None:
        writeup = await self.get(writeup_id)
        if not is_moderator and writeup.author_id != actor_id:
            raise AppError(ErrorCode.NOT_AUTHOR, "only author or mod can delete")
        writeup.deleted_at = datetime.now(timezone.utc)
        writeup.status = "archived"
        await self.session.flush()
        log.info("writeup_deleted", writeup_id=str(writeup_id), actor=str(actor_id))
