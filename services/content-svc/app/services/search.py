"""Unified search across machines, challenges, and paths."""

from __future__ import annotations

from typing import cast

from sqlalchemy import func, literal, or_, select, union_all
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, ErrorCode
from app.models import Challenge, LearningPath, Machine
from app.schemas import SearchHit


class SearchService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def search(
        self,
        *,
        query: str,
        type_: str = "all",
        viewer_tier: str = "free",
        difficulty: str | None = None,
        limit: int = 25,
    ) -> tuple[list[SearchHit], dict[str, dict[str, int]]]:
        """Search across content types.

        Returns (hits, facets). Facets: {type: {value: count}}.
        """
        q = query.strip()
        if len(q) < 2:
            raise AppError(ErrorCode.VALIDATION, "search query must be at least 2 characters")
        if len(q) > 200:
            raise AppError(ErrorCode.VALIDATION, "search query too long")

        pattern = f"%{q.lower()}%"
        hits: list[SearchHit] = []

        if type_ in ("machine", "all"):
            stmt = (
                select(
                    literal("machine").label("type"),
                    Machine.id,
                    Machine.slug,
                    Machine.name,
                    Machine.description,
                    Machine.difficulty,
                    Machine.cover_image_url,
                    Machine.rating_avg,
                )
                .where(
                    Machine.status.in_(["active", "retired"]),
                    or_(
                        func.lower(Machine.name).like(pattern),
                        func.lower(Machine.description).like(pattern),
                        func.lower(Machine.slug).like(pattern),
                    ),
                )
            )
            if viewer_tier == "free":
                stmt = stmt.where(Machine.required_tier == "free")
            elif viewer_tier == "vip":
                stmt = stmt.where(Machine.required_tier.in_(["free", "vip"]))
            if difficulty:
                stmt = stmt.where(Machine.difficulty == difficulty)

            result = await self.session.execute(stmt.limit(limit))
            for row in result:
                hits.append(
                    SearchHit(
                        type="machine",
                        id=row.id,
                        slug=row.slug,
                        name=row.name,
                        description=row.description,
                        difficulty=row.difficulty,
                        cover_image_url=row.cover_image_url,
                        rating_avg=row.rating_avg,
                    )
                )

        if type_ in ("challenge", "all"):
            stmt = (
                select(
                    literal("challenge").label("type"),
                    Challenge.id,
                    Challenge.slug,
                    Challenge.name,
                    Challenge.description,
                    Challenge.difficulty,
                    Challenge.cover_image_url,
                    Challenge.rating_avg,
                )
                .where(
                    Challenge.status.in_(["active", "retired"]),
                    or_(
                        func.lower(Challenge.name).like(pattern),
                        func.lower(Challenge.description).like(pattern),
                        func.lower(Challenge.slug).like(pattern),
                    ),
                )
            )
            if viewer_tier == "free":
                stmt = stmt.where(Challenge.required_tier == "free")
            elif viewer_tier == "vip":
                stmt = stmt.where(Challenge.required_tier.in_(["free", "vip"]))
            if difficulty:
                stmt = stmt.where(Challenge.difficulty == difficulty)

            result = await self.session.execute(stmt.limit(limit))
            for row in result:
                hits.append(
                    SearchHit(
                        type="challenge",
                        id=row.id,
                        slug=row.slug,
                        name=row.name,
                        description=row.description,
                        difficulty=row.difficulty,
                        cover_image_url=row.cover_image_url,
                        rating_avg=row.rating_avg,
                    )
                )

        if type_ in ("path", "all"):
            stmt = (
                select(
                    literal("path").label("type"),
                    LearningPath.id,
                    LearningPath.slug,
                    LearningPath.name,
                    LearningPath.description,
                    LearningPath.difficulty,
                    LearningPath.cover_image_url,
                    LearningPath.rating_avg,
                )
                .where(
                    LearningPath.status == "active",
                    or_(
                        func.lower(LearningPath.name).like(pattern),
                        func.lower(LearningPath.description).like(pattern),
                        func.lower(LearningPath.slug).like(pattern),
                    ),
                )
            )
            if viewer_tier == "free":
                stmt = stmt.where(LearningPath.required_tier == "free")
            elif viewer_tier == "vip":
                stmt = stmt.where(LearningPath.required_tier.in_(["free", "vip"]))

            result = await self.session.execute(stmt.limit(limit))
            for row in result:
                hits.append(
                    SearchHit(
                        type="path",
                        id=row.id,
                        slug=row.slug,
                        name=row.name,
                        description=row.description,
                        difficulty=row.difficulty,
                        cover_image_url=row.cover_image_url,
                        rating_avg=row.rating_avg,
                    )
                )

        # Build facets
        facets: dict[str, dict[str, int]] = {"type": {}, "difficulty": {}}
        for hit in hits:
            facets["type"][hit.type] = facets["type"].get(hit.type, 0) + 1
            facets["difficulty"][hit.difficulty] = (
                facets["difficulty"].get(hit.difficulty, 0) + 1
            )

        # Trim to overall limit
        hits = hits[:limit]
        return hits, facets
