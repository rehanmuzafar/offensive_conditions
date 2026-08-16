"""Challenge service: list, get, create, update, lifecycle."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import AppError, ErrorCode
from app.core.logging import get_logger
from app.models import Challenge, ChallengeTag, Tag
from app.schemas import ChallengeCreate, ChallengeUpdate

log = get_logger("challenges")

_ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "draft": {"review", "archived"},
    "review": {"draft", "active", "archived"},
    "active": {"retired", "archived"},
    "retired": {"archived", "active"},
    "archived": set(),
}


class ChallengeService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(self, challenge_id: UUID) -> Challenge:
        result = await self.session.execute(
            select(Challenge)
            .options(selectinload(Challenge.tags).selectinload(ChallengeTag.tag))
            .where(Challenge.id == challenge_id)
        )
        challenge = result.scalar_one_or_none()
        if not challenge:
            raise AppError(ErrorCode.CHALLENGE_NOT_FOUND, "challenge not found")
        return challenge

    async def get_by_slug(self, slug: str) -> Challenge:
        result = await self.session.execute(
            select(Challenge)
            .options(selectinload(Challenge.tags).selectinload(ChallengeTag.tag))
            .where(func.lower(Challenge.slug) == slug.lower())
        )
        challenge = result.scalar_one_or_none()
        if not challenge:
            raise AppError(ErrorCode.CHALLENGE_NOT_FOUND, "challenge not found")
        return challenge

    async def list_(
        self,
        *,
        viewer_tier: str = "free",
        status: str | None = None,
        difficulty: str | None = None,
        category_id: UUID | None = None,
        tag_slugs: list[str] | None = None,
        search: str | None = None,
        limit: int = 25,
        offset: int = 0,
        include_unpublished: bool = False,
    ) -> tuple[list[Challenge], int]:
        stmt = (
            select(Challenge)
            .options(selectinload(Challenge.tags).selectinload(ChallengeTag.tag))
            .order_by(Challenge.released_at.desc().nullslast(), Challenge.created_at.desc())
        )
        count_stmt = select(func.count()).select_from(Challenge)

        if not include_unpublished:
            stmt = stmt.where(Challenge.status.in_(["active", "retired"]))
            count_stmt = count_stmt.where(Challenge.status.in_(["active", "retired"]))
        elif status:
            stmt = stmt.where(Challenge.status == status)
            count_stmt = count_stmt.where(Challenge.status == status)

        if viewer_tier == "free":
            stmt = stmt.where(Challenge.required_tier == "free")
            count_stmt = count_stmt.where(Challenge.required_tier == "free")
        elif viewer_tier == "vip":
            stmt = stmt.where(Challenge.required_tier.in_(["free", "vip"]))
            count_stmt = count_stmt.where(Challenge.required_tier.in_(["free", "vip"]))

        if difficulty:
            stmt = stmt.where(Challenge.difficulty == difficulty)
            count_stmt = count_stmt.where(Challenge.difficulty == difficulty)
        if category_id:
            stmt = stmt.where(Challenge.category_id == category_id)
            count_stmt = count_stmt.where(Challenge.category_id == category_id)
        if search:
            pattern = f"%{search.lower()}%"
            cond = or_(
                func.lower(Challenge.name).like(pattern),
                func.lower(Challenge.description).like(pattern),
                func.lower(Challenge.slug).like(pattern),
            )
            stmt = stmt.where(cond)
            count_stmt = count_stmt.where(cond)
        if tag_slugs:
            stmt = stmt.join(ChallengeTag).join(Tag).where(Tag.slug.in_(tag_slugs)).distinct()
            count_stmt = (
                count_stmt.select_from(Challenge)
                .join(ChallengeTag)
                .join(Tag)
                .where(Tag.slug.in_(tag_slugs))
            )

        total = (await self.session.execute(count_stmt)).scalar_one()
        result = await self.session.execute(stmt.limit(limit).offset(offset))
        return list(result.scalars().unique().all()), int(total)

    async def create(self, *, creator_id: UUID, data: ChallengeCreate) -> Challenge:
        tag_ids = data.tags
        body = data.model_dump(exclude={"tags"})
        # files is a list[ChallengeFile] - convert to list[dict]
        body["files"] = [f if isinstance(f, dict) else f.model_dump() for f in body.get("files", [])]
        challenge = Challenge(creator_id=creator_id, **body)
        self.session.add(challenge)
        try:
            await self.session.flush()
        except IntegrityError as e:
            await self.session.rollback()
            if "slug" in str(e.orig).lower():
                raise AppError(ErrorCode.SLUG_TAKEN, "slug already in use")
            raise
        for tag_id in tag_ids:
            self.session.add(ChallengeTag(challenge_id=challenge.id, tag_id=tag_id))
        await self.session.flush()
        await self.session.refresh(challenge, ["tags"])
        log.info("challenge_created", challenge_id=str(challenge.id), creator=str(creator_id))
        return challenge

    async def update(
        self,
        challenge_id: UUID,
        *,
        actor_id: UUID,
        is_staff: bool,
        data: ChallengeUpdate,
    ) -> Challenge:
        challenge = await self.get(challenge_id)
        if not is_staff and challenge.creator_id != actor_id:
            raise AppError(ErrorCode.NOT_CREATOR, "you can only edit your own challenges")
        if challenge.status in ("active", "retired", "archived") and not is_staff:
            raise AppError(ErrorCode.FORBIDDEN, "challenge is locked")

        body = data.model_dump(exclude_unset=True, exclude={"tags"})
        if "files" in body and body["files"] is not None:
            body["files"] = [
                f if isinstance(f, dict) else f.model_dump() for f in body["files"]
            ]
        for k, v in body.items():
            setattr(challenge, k, v)

        if data.tags is not None:
            await self.session.execute(
                delete(ChallengeTag).where(ChallengeTag.challenge_id == challenge_id)
            )
            for tag_id in data.tags:
                self.session.add(ChallengeTag(challenge_id=challenge_id, tag_id=tag_id))

        await self.session.flush()
        await self.session.refresh(challenge, ["tags"])
        return challenge

    async def transition_status(
        self,
        challenge_id: UUID,
        *,
        new_status: str,
        actor_id: UUID,
        is_staff: bool,
    ) -> Challenge:
        challenge = await self.get(challenge_id)
        allowed = _ALLOWED_TRANSITIONS.get(challenge.status, set())
        if new_status not in allowed:
            raise AppError(
                ErrorCode.INVALID_STATUS_TRANSITION,
                f"cannot transition from {challenge.status} to {new_status}",
            )
        if new_status == "review":
            if challenge.creator_id != actor_id and not is_staff:
                raise AppError(ErrorCode.NOT_CREATOR, "only the creator can submit for review")
        elif new_status in ("active", "retired", "archived"):
            if not is_staff:
                raise AppError(ErrorCode.NOT_MODERATOR, "only staff can publish/retire/archive")

        challenge.status = new_status
        if new_status == "active" and challenge.released_at is None:
            challenge.released_at = datetime.now(timezone.utc)
        if new_status == "retired" and challenge.retired_at is None:
            challenge.retired_at = datetime.now(timezone.utc)
        await self.session.flush()
        return challenge

    async def increment_solves(self, challenge_id: UUID) -> None:
        await self.session.execute(
            Challenge.__table__.update()
            .where(Challenge.id == challenge_id)
            .values(total_solves=Challenge.total_solves + 1)
        )
