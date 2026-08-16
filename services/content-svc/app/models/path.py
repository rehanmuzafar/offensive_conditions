"""Learning path (track) models, matching Phase 2 schema."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class LearningPath(Base, TimestampMixin):
    """A curated sequence of machines / challenges / lesson modules."""

    __tablename__ = "learning_paths"
    __table_args__ = {"schema": "content"}

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    slug: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    overview_markdown: Mapped[str | None] = mapped_column(Text)

    difficulty: Mapped[str] = mapped_column(String(16), nullable=False)
    category_id: Mapped[UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("content.categories.id", ondelete="SET NULL")
    )
    estimated_hours: Mapped[int | None] = mapped_column(Integer)

    # Progression denormalized
    module_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    machine_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    challenge_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Stats
    total_completions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_enrollments: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rating_avg: Mapped[Decimal | None] = mapped_column(Numeric(3, 2))
    rating_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    required_tier: Mapped[str] = mapped_column(String(16), nullable=False, default="free")

    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft")
    creator_id: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cover_image_url: Mapped[str | None] = mapped_column(Text)

    completion_certificate: Mapped[bool] = mapped_column(nullable=False, default=False)
    completion_points: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completion_badge_id: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))

    modules: Mapped[list["PathModule"]] = relationship(
        back_populates="path",
        cascade="all, delete-orphan",
        order_by="PathModule.sequence",
        lazy="selectin",
    )


class PathModule(Base, TimestampMixin):
    """A single lesson/exercise within a learning path."""

    __tablename__ = "path_modules"
    __table_args__ = (
        UniqueConstraint("path_id", "sequence", name="uq_path_module_sequence"),
        {"schema": "content"},
    )

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    path_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("content.learning_paths.id", ondelete="CASCADE"),
        nullable=False,
    )
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    content_markdown: Mapped[str] = mapped_column(Text, nullable=False)
    estimated_minutes: Mapped[int | None] = mapped_column(Integer)

    # Optional linked content (machine OR challenge OR both nullable)
    machine_id: Mapped[UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("content.machines.id", ondelete="SET NULL")
    )
    challenge_id: Mapped[UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("content.challenges.id", ondelete="SET NULL")
    )

    # Module questions/quizzes
    questions: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, default=list, server_default="[]"
    )

    is_optional: Mapped[bool] = mapped_column(nullable=False, default=False)
    requires_previous: Mapped[bool] = mapped_column(nullable=False, default=True)
    completion_points: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    path: Mapped[LearningPath] = relationship(back_populates="modules")


class PathEnrollment(Base, TimestampMixin):
    """Tracks a user's enrollment in a learning path."""

    __tablename__ = "path_enrollments"
    __table_args__ = (
        UniqueConstraint("user_id", "path_id", name="uq_path_enrollment"),
        {"schema": "content"},
    )

    user_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True)
    path_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("content.learning_paths.id", ondelete="CASCADE"),
        primary_key=True,
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    progress_percent: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_activity_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ModuleProgress(Base, TimestampMixin):
    """Per-user, per-module completion state."""

    __tablename__ = "module_progress"
    __table_args__ = (
        UniqueConstraint("user_id", "module_id", name="uq_module_progress"),
        {"schema": "content"},
    )

    user_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True)
    module_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("content.path_modules.id", ondelete="CASCADE"),
        primary_key=True,
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="in_progress")
    correct_answers: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_questions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
