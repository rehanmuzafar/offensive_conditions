"""Machine service: list, get, create, update, lifecycle, rate."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import AppError, ErrorCode
from app.core.logging import get_logger
from app.models import Machine, MachineRating, MachineTag, Tag
from app.schemas import MachineCreate, MachineRate, MachineUpdate

log = get_logger("machines")


# Allowed status transitions. Anything not in this dict is invalid.
_ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "draft": {"review", "archived"},
    "review": {"draft", "active", "archived"},  # back to draft if rejected
    "active": {"retired", "archived"},
    "retired": {"archived", "active"},  # re-activate possible
    "archived": set(),  # terminal
}


class MachineService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # =========================================================================
    # Read
    # =========================================================================

    async def get(self, machine_id: UUID) -> Machine:
        result = await self.session.execute(
            select(Machine)
            .options(selectinload(Machine.tags).selectinload(MachineTag.tag))
            .where(Machine.id == machine_id)
        )
        machine = result.scalar_one_or_none()
        if not machine:
            raise AppError(ErrorCode.MACHINE_NOT_FOUND, "machine not found")
        return machine

    async def get_by_slug(self, slug: str) -> Machine:
        result = await self.session.execute(
            select(Machine)
            .options(selectinload(Machine.tags).selectinload(MachineTag.tag))
            .where(func.lower(Machine.slug) == slug.lower())
        )
        machine = result.scalar_one_or_none()
        if not machine:
            raise AppError(ErrorCode.MACHINE_NOT_FOUND, "machine not found")
        return machine

    async def list_(
        self,
        *,
        viewer_tier: str = "free",
        status: str | None = None,
        difficulty: str | None = None,
        os: str | None = None,
        category_id: UUID | None = None,
        tag_slugs: list[str] | None = None,
        search: str | None = None,
        limit: int = 25,
        offset: int = 0,
        include_unpublished: bool = False,
    ) -> tuple[list[Machine], int]:
        """List machines with filters. Returns (items, total_count)."""
        stmt = (
            select(Machine)
            .options(selectinload(Machine.tags).selectinload(MachineTag.tag))
            .order_by(Machine.released_at.desc().nullslast(), Machine.created_at.desc())
        )
        count_stmt = select(func.count()).select_from(Machine)

        # Default: only show active/retired publicly. Creators/admins see drafts via include_unpublished.
        if not include_unpublished:
            stmt = stmt.where(Machine.status.in_(["active", "retired"]))
            count_stmt = count_stmt.where(Machine.status.in_(["active", "retired"]))
        elif status:
            stmt = stmt.where(Machine.status == status)
            count_stmt = count_stmt.where(Machine.status == status)

        # Tier gating - non-pro users only see machines they can access
        if viewer_tier == "free":
            stmt = stmt.where(Machine.required_tier == "free")
            count_stmt = count_stmt.where(Machine.required_tier == "free")
        elif viewer_tier == "vip":
            stmt = stmt.where(Machine.required_tier.in_(["free", "vip"]))
            count_stmt = count_stmt.where(Machine.required_tier.in_(["free", "vip"]))

        if difficulty:
            stmt = stmt.where(Machine.difficulty == difficulty)
            count_stmt = count_stmt.where(Machine.difficulty == difficulty)
        if os:
            stmt = stmt.where(Machine.os == os)
            count_stmt = count_stmt.where(Machine.os == os)
        if category_id:
            stmt = stmt.where(Machine.category_id == category_id)
            count_stmt = count_stmt.where(Machine.category_id == category_id)
        if search:
            pattern = f"%{search.lower()}%"
            cond = or_(
                func.lower(Machine.name).like(pattern),
                func.lower(Machine.description).like(pattern),
                func.lower(Machine.slug).like(pattern),
            )
            stmt = stmt.where(cond)
            count_stmt = count_stmt.where(cond)
        if tag_slugs:
            # Inner join with machine_tags + tags filter
            stmt = stmt.join(MachineTag).join(Tag).where(Tag.slug.in_(tag_slugs)).distinct()
            count_stmt = (
                count_stmt.select_from(Machine)
                .join(MachineTag)
                .join(Tag)
                .where(Tag.slug.in_(tag_slugs))
            )

        total = (await self.session.execute(count_stmt)).scalar_one()
        result = await self.session.execute(stmt.limit(limit).offset(offset))
        return list(result.scalars().unique().all()), int(total)

    async def list_owners(self, machine_id: UUID, limit: int = 50) -> list[UUID]:
        """List user IDs who have completed this machine (root flag).

        In production, this calls scoring service via gRPC. For now we return empty.
        """
        # placeholder: real impl will resolve via scoring.GetMachineOwners gRPC
        return []

    # =========================================================================
    # Write
    # =========================================================================

    async def create(self, *, creator_id: UUID, data: MachineCreate) -> Machine:
        tag_ids = data.tags
        # The `tags` key is a list of UUIDs in MachineCreate; we strip it before model_dump.
        body = data.model_dump(exclude={"tags"})
        machine = Machine(creator_id=creator_id, **body)
        self.session.add(machine)
        try:
            await self.session.flush()
        except IntegrityError as e:
            await self.session.rollback()
            if "slug" in str(e.orig).lower():
                raise AppError(ErrorCode.SLUG_TAKEN, "slug already in use")
            raise

        # Attach tags
        for tag_id in tag_ids:
            self.session.add(MachineTag(machine_id=machine.id, tag_id=tag_id))

        await self.session.flush()
        await self.session.refresh(machine, ["tags"])
        log.info("machine_created", machine_id=str(machine.id), creator=str(creator_id))
        return machine

    async def update(
        self, machine_id: UUID, *, actor_id: UUID, is_staff: bool, data: MachineUpdate
    ) -> Machine:
        machine = await self.get(machine_id)
        # Only creator can edit drafts; admins/moderators can edit anything
        if not is_staff and machine.creator_id != actor_id:
            raise AppError(ErrorCode.NOT_CREATOR, "you can only edit your own machines")
        # Once active or retired, only staff can edit non-content fields
        if machine.status in ("active", "retired", "archived") and not is_staff:
            raise AppError(
                ErrorCode.FORBIDDEN, "machine is locked; submit a change request to a moderator"
            )

        body = data.model_dump(exclude_unset=True, exclude={"tags"})
        for k, v in body.items():
            setattr(machine, k, v)

        if data.tags is not None:
            await self.session.execute(
                delete(MachineTag).where(MachineTag.machine_id == machine_id)
            )
            for tag_id in data.tags:
                self.session.add(MachineTag(machine_id=machine_id, tag_id=tag_id))

        await self.session.flush()
        await self.session.refresh(machine, ["tags"])
        log.info("machine_updated", machine_id=str(machine_id), fields=list(body.keys()))
        return machine

    # =========================================================================
    # Lifecycle
    # =========================================================================

    async def transition_status(
        self,
        machine_id: UUID,
        *,
        new_status: str,
        actor_id: UUID,
        is_staff: bool,
        reviewer_id: UUID | None = None,
    ) -> Machine:
        machine = await self.get(machine_id)
        allowed = _ALLOWED_TRANSITIONS.get(machine.status, set())
        if new_status not in allowed:
            raise AppError(
                ErrorCode.INVALID_STATUS_TRANSITION,
                f"cannot transition from {machine.status} to {new_status}",
            )
        # Authorization
        if new_status == "review":
            # Creator submits for review
            if machine.creator_id != actor_id and not is_staff:
                raise AppError(ErrorCode.NOT_CREATOR, "only the creator can submit for review")
        elif new_status in ("active", "retired", "archived"):
            if not is_staff:
                raise AppError(ErrorCode.NOT_MODERATOR, "only staff can publish/retire/archive")

        machine.status = new_status
        if new_status == "active" and machine.released_at is None:
            machine.released_at = datetime.now(timezone.utc)
        if new_status == "retired" and machine.retired_at is None:
            machine.retired_at = datetime.now(timezone.utc)
        if reviewer_id:
            machine.reviewer_id = reviewer_id
        await self.session.flush()
        log.info(
            "machine_status_changed",
            machine_id=str(machine_id),
            from_status=machine.status,
            to_status=new_status,
            actor=str(actor_id),
        )
        return machine

    # =========================================================================
    # Ratings
    # =========================================================================

    async def rate(self, machine_id: UUID, *, user_id: UUID, data: MachineRate) -> None:
        # Verify machine exists + is rateable
        machine = await self.get(machine_id)
        if machine.status not in ("active", "retired"):
            raise AppError(ErrorCode.FORBIDDEN, "can only rate published machines")

        # Upsert rating
        existing = await self.session.execute(
            select(MachineRating).where(
                and_(MachineRating.user_id == user_id, MachineRating.machine_id == machine_id)
            )
        )
        rating = existing.scalar_one_or_none()
        if rating:
            rating.rating = data.rating
            rating.difficulty_vote = data.difficulty_vote
            rating.comment = data.comment
        else:
            self.session.add(
                MachineRating(
                    user_id=user_id,
                    machine_id=machine_id,
                    rating=data.rating,
                    difficulty_vote=data.difficulty_vote,
                    comment=data.comment,
                )
            )
        await self.session.flush()
        # Refresh denormalized stats
        await self._refresh_rating_stats(machine_id)
        log.info("machine_rated", machine_id=str(machine_id), user_id=str(user_id), rating=data.rating)

    async def list_reviews(
        self, machine_id: UUID, *, limit: int = 25, offset: int = 0
    ) -> tuple[list[MachineRating], int]:
        # Verify machine exists
        await self.get(machine_id)
        stmt = (
            select(MachineRating)
            .where(MachineRating.machine_id == machine_id)
            .order_by(MachineRating.created_at.desc())
        )
        count_stmt = (
            select(func.count())
            .select_from(MachineRating)
            .where(MachineRating.machine_id == machine_id)
        )
        total = (await self.session.execute(count_stmt)).scalar_one()
        result = await self.session.execute(stmt.limit(limit).offset(offset))
        return list(result.scalars().all()), int(total)

    async def _refresh_rating_stats(self, machine_id: UUID) -> None:
        result = await self.session.execute(
            select(
                func.avg(MachineRating.rating).label("avg"),
                func.count(MachineRating.user_id).label("count"),
            ).where(MachineRating.machine_id == machine_id)
        )
        row = result.one()
        await self.session.execute(
            Machine.__table__.update()
            .where(Machine.id == machine_id)
            .values(rating_avg=row.avg, rating_count=int(row.count or 0))
        )

    # =========================================================================
    # Stats (called by scoring service via Kafka consumer or Celery)
    # =========================================================================

    async def increment_owns(self, machine_id: UUID, *, flag_type: str) -> None:
        col = (
            Machine.total_user_owns
            if flag_type == "user"
            else Machine.total_root_owns
        )
        await self.session.execute(
            Machine.__table__.update()
            .where(Machine.id == machine_id)
            .values({col.key: col + 1})
        )

    async def get_stats(self, machine_id: UUID) -> dict[str, Any]:
        machine = await self.get(machine_id)
        # Difficulty distribution from user votes
        dist_result = await self.session.execute(
            select(
                MachineRating.difficulty_vote,
                func.count(MachineRating.user_id),
            )
            .where(
                and_(
                    MachineRating.machine_id == machine_id,
                    MachineRating.difficulty_vote.isnot(None),
                )
            )
            .group_by(MachineRating.difficulty_vote)
        )
        distribution = {row[0]: int(row[1]) for row in dist_result}
        return {
            "total_user_owns": machine.total_user_owns,
            "total_root_owns": machine.total_root_owns,
            "avg_user_solve_minutes": machine.avg_user_solve_minutes,
            "avg_root_solve_minutes": machine.avg_root_solve_minutes,
            "rating_avg": machine.rating_avg,
            "rating_count": machine.rating_count,
            "difficulty_distribution": distribution,
        }
