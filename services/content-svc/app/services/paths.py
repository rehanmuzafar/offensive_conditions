"""Learning path service: enrollment, progress, module completion."""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import AppError, ErrorCode
from app.core.logging import get_logger
from app.models import LearningPath, ModuleProgress, PathEnrollment, PathModule

log = get_logger("paths")


class PathService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(self, path_id: UUID) -> LearningPath:
        result = await self.session.execute(
            select(LearningPath)
            .options(selectinload(LearningPath.modules))
            .where(LearningPath.id == path_id)
        )
        path = result.scalar_one_or_none()
        if not path:
            raise AppError(ErrorCode.PATH_NOT_FOUND, "learning path not found")
        return path

    async def get_by_slug(self, slug: str) -> LearningPath:
        result = await self.session.execute(
            select(LearningPath)
            .options(selectinload(LearningPath.modules))
            .where(func.lower(LearningPath.slug) == slug.lower())
        )
        path = result.scalar_one_or_none()
        if not path:
            raise AppError(ErrorCode.PATH_NOT_FOUND, "learning path not found")
        return path

    async def list_(
        self,
        *,
        viewer_tier: str = "free",
        difficulty: str | None = None,
        category_id: UUID | None = None,
        limit: int = 25,
        offset: int = 0,
        include_unpublished: bool = False,
    ) -> tuple[list[LearningPath], int]:
        stmt = select(LearningPath).order_by(
            LearningPath.released_at.desc().nullslast(),
            LearningPath.created_at.desc(),
        )
        count_stmt = select(func.count()).select_from(LearningPath)

        if not include_unpublished:
            stmt = stmt.where(LearningPath.status == "active")
            count_stmt = count_stmt.where(LearningPath.status == "active")
        if viewer_tier == "free":
            stmt = stmt.where(LearningPath.required_tier == "free")
            count_stmt = count_stmt.where(LearningPath.required_tier == "free")
        elif viewer_tier == "vip":
            stmt = stmt.where(LearningPath.required_tier.in_(["free", "vip"]))
            count_stmt = count_stmt.where(LearningPath.required_tier.in_(["free", "vip"]))
        if difficulty:
            stmt = stmt.where(LearningPath.difficulty == difficulty)
            count_stmt = count_stmt.where(LearningPath.difficulty == difficulty)
        if category_id:
            stmt = stmt.where(LearningPath.category_id == category_id)
            count_stmt = count_stmt.where(LearningPath.category_id == category_id)

        total = (await self.session.execute(count_stmt)).scalar_one()
        result = await self.session.execute(stmt.limit(limit).offset(offset))
        return list(result.scalars().all()), int(total)

    # =========================================================================
    # Enrollment
    # =========================================================================

    async def enroll(self, path_id: UUID, *, user_id: UUID) -> PathEnrollment:
        # Verify path is enrollable
        path = await self.get(path_id)
        if path.status != "active":
            raise AppError(ErrorCode.FORBIDDEN, "path is not currently active")

        existing = await self.session.execute(
            select(PathEnrollment).where(
                and_(
                    PathEnrollment.user_id == user_id,
                    PathEnrollment.path_id == path_id,
                )
            )
        )
        enrollment = existing.scalar_one_or_none()
        if enrollment and enrollment.status == "active":
            raise AppError(ErrorCode.ALREADY_ENROLLED, "already enrolled in this path")
        if enrollment:
            enrollment.status = "active"
            enrollment.last_activity_at = datetime.now(timezone.utc)
        else:
            enrollment = PathEnrollment(
                user_id=user_id,
                path_id=path_id,
                status="active",
                progress_percent=0,
                last_activity_at=datetime.now(timezone.utc),
            )
            self.session.add(enrollment)
        await self.session.execute(
            LearningPath.__table__.update()
            .where(LearningPath.id == path_id)
            .values(total_enrollments=LearningPath.total_enrollments + 1)
        )
        await self.session.flush()
        log.info("path_enrolled", user_id=str(user_id), path_id=str(path_id))
        return enrollment

    async def get_progress(self, path_id: UUID, *, user_id: UUID) -> dict:
        path = await self.get(path_id)
        enrollment_result = await self.session.execute(
            select(PathEnrollment).where(
                and_(
                    PathEnrollment.user_id == user_id,
                    PathEnrollment.path_id == path_id,
                )
            )
        )
        enrollment = enrollment_result.scalar_one_or_none()
        if not enrollment:
            raise AppError(ErrorCode.NOT_ENROLLED, "not enrolled in this path")

        # Modules completed
        completed_result = await self.session.execute(
            select(func.count(ModuleProgress.module_id)).where(
                and_(
                    ModuleProgress.user_id == user_id,
                    ModuleProgress.status == "completed",
                    ModuleProgress.module_id.in_(
                        select(PathModule.id).where(PathModule.path_id == path_id)
                    ),
                )
            )
        )
        completed_count = int(completed_result.scalar_one() or 0)
        total_modules = len(path.modules)

        # Find next module (lowest sequence among non-completed, optional respected)
        completed_ids_result = await self.session.execute(
            select(ModuleProgress.module_id).where(
                and_(
                    ModuleProgress.user_id == user_id,
                    ModuleProgress.status == "completed",
                )
            )
        )
        completed_ids = {row[0] for row in completed_ids_result}
        next_module_id: UUID | None = None
        for module in sorted(path.modules, key=lambda m: m.sequence):
            if module.id not in completed_ids and not module.is_optional:
                next_module_id = module.id
                break

        return {
            "enrollment": enrollment,
            "modules_completed": completed_count,
            "modules_total": total_modules,
            "next_module_id": next_module_id,
        }

    async def list_my_enrollments(self, user_id: UUID) -> list[PathEnrollment]:
        result = await self.session.execute(
            select(PathEnrollment)
            .where(PathEnrollment.user_id == user_id)
            .order_by(PathEnrollment.last_activity_at.desc().nullslast())
        )
        return list(result.scalars().all())

    # =========================================================================
    # Module completion
    # =========================================================================

    async def complete_module(
        self, module_id: UUID, *, user_id: UUID, answers: dict[str, str]
    ) -> dict:
        # Fetch module
        result = await self.session.execute(
            select(PathModule).where(PathModule.id == module_id)
        )
        module = result.scalar_one_or_none()
        if not module:
            raise AppError(ErrorCode.NOT_FOUND, "module not found")

        # Verify user is enrolled in the path
        enrollment_result = await self.session.execute(
            select(PathEnrollment).where(
                and_(
                    PathEnrollment.user_id == user_id,
                    PathEnrollment.path_id == module.path_id,
                )
            )
        )
        if enrollment_result.scalar_one_or_none() is None:
            raise AppError(ErrorCode.NOT_ENROLLED, "not enrolled in this path")

        # Score the answers
        questions = module.questions or []
        correct = 0
        total = len(questions)
        for q in questions:
            qid = q.get("id")
            expected_hash = q.get("answer_hash")
            answer = answers.get(qid, "").strip().lower()
            if not expected_hash or not answer:
                continue
            given_hash = hashlib.sha256(answer.encode("utf-8")).hexdigest()
            if given_hash == expected_hash:
                correct += 1

        # Module is "complete" if all required questions answered correctly (or no questions)
        completed = total == 0 or correct == total

        # Upsert progress
        existing = await self.session.execute(
            select(ModuleProgress).where(
                and_(
                    ModuleProgress.user_id == user_id,
                    ModuleProgress.module_id == module_id,
                )
            )
        )
        progress = existing.scalar_one_or_none()
        if progress:
            progress.status = "completed" if completed else "in_progress"
            progress.correct_answers = correct
            progress.total_questions = total
            if completed and progress.completed_at is None:
                progress.completed_at = datetime.now(timezone.utc)
        else:
            progress = ModuleProgress(
                user_id=user_id,
                module_id=module_id,
                status="completed" if completed else "in_progress",
                correct_answers=correct,
                total_questions=total,
                completed_at=datetime.now(timezone.utc) if completed else None,
            )
            self.session.add(progress)
        await self.session.flush()

        # Recompute enrollment progress %
        path_modules_result = await self.session.execute(
            select(PathModule.id, PathModule.is_optional).where(
                PathModule.path_id == module.path_id
            )
        )
        all_modules = list(path_modules_result.all())
        required_total = sum(1 for _, optional in all_modules if not optional)

        completed_required_result = await self.session.execute(
            select(func.count(ModuleProgress.module_id)).where(
                and_(
                    ModuleProgress.user_id == user_id,
                    ModuleProgress.status == "completed",
                    ModuleProgress.module_id.in_(
                        select(PathModule.id).where(
                            and_(
                                PathModule.path_id == module.path_id,
                                PathModule.is_optional.is_(False),
                            )
                        )
                    ),
                )
            )
        )
        completed_required = int(completed_required_result.scalar_one() or 0)

        percent = 0
        if required_total > 0:
            percent = min(100, int(100 * completed_required / required_total))

        path_completed = required_total > 0 and completed_required == required_total
        await self.session.execute(
            PathEnrollment.__table__.update()
            .where(
                and_(
                    PathEnrollment.user_id == user_id,
                    PathEnrollment.path_id == module.path_id,
                )
            )
            .values(
                progress_percent=percent,
                status="completed" if path_completed else "active",
                completed_at=datetime.now(timezone.utc) if path_completed else None,
                last_activity_at=datetime.now(timezone.utc),
            )
        )

        # If path just completed, bump global total_completions
        if path_completed:
            await self.session.execute(
                LearningPath.__table__.update()
                .where(LearningPath.id == module.path_id)
                .values(total_completions=LearningPath.total_completions + 1)
            )

        return {
            "module_id": module_id,
            "completed": completed,
            "correct_answers": correct,
            "total_questions": total,
            "points_earned": module.completion_points if completed else 0,
        }
