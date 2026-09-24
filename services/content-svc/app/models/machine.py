"""ORM models matching the Phase 2 content schema."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import (
    ARRAY,
    BigInteger,
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


# =============================================================================
# Categories + tags
# =============================================================================


class Category(Base, TimestampMixin):
    __tablename__ = "categories"
    __table_args__ = {"schema": "content"}

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    slug: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    parent_id: Mapped[UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("content.categories.id", ondelete="SET NULL")
    )
    icon: Mapped[str | None] = mapped_column(String(64))
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class Tag(Base, TimestampMixin):
    __tablename__ = "tags"
    __table_args__ = {"schema": "content"}

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    slug: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    color: Mapped[str | None] = mapped_column(String(7))  # hex


# =============================================================================
# Machines
# =============================================================================


class Machine(Base, TimestampMixin):
    """A box you SSH/RDP into. Two-flag (user/root) or single-flag."""

    __tablename__ = "machines"
    __table_args__ = {"schema": "content"}

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    slug: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)

    # Classification
    os: Mapped[str] = mapped_column(String(16), nullable=False)
    difficulty: Mapped[str] = mapped_column(String(16), nullable=False)
    category_id: Mapped[UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("content.categories.id", ondelete="SET NULL")
    )

    # Lab specs
    backend: Mapped[str] = mapped_column(String(16), nullable=False)
    #: How a player reaches the box: spawn | static_host | download.
    #: Separate from `backend`, which is only about how `spawn` provisions.
    #: See migration 0003.
    delivery: Mapped[str] = mapped_column(
        Text, nullable=False, default="spawn", server_default="spawn"
    )
    #: Only `spawn` has an image; the check constraint enforces the rest.
    image_ref: Mapped[str | None] = mapped_column(Text)
    image_version: Mapped[str | None] = mapped_column(String(64))
    #: `static_host` — the always-on host players attack.
    static_host: Mapped[str | None] = mapped_column(Text)
    #: `download` — a boot2root image the player runs themselves.
    download_url: Mapped[str | None] = mapped_column(Text)
    download_sha256: Mapped[str | None] = mapped_column(Text)
    download_size_bytes: Mapped[int | None] = mapped_column(BigInteger)
    download_format: Mapped[str | None] = mapped_column(Text)
    cpu_request: Mapped[str] = mapped_column(String(16), nullable=False, default="500m")
    memory_request: Mapped[str] = mapped_column(String(16), nullable=False, default="512Mi")
    cpu_limit: Mapped[str] = mapped_column(String(16), nullable=False, default="1000m")
    memory_limit: Mapped[str] = mapped_column(String(16), nullable=False, default="1Gi")
    disk_gb: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
    expected_ports: Mapped[list[int]] = mapped_column(
        ARRAY(Integer), nullable=False, default=list, server_default="{}"
    )

    # Scoring
    base_user_points: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    base_root_points: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    base_challenge_points: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Aggregate stats (denormalized; updated by Celery)
    total_user_owns: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_root_owns: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    avg_user_solve_minutes: Mapped[int | None] = mapped_column(Integer)
    avg_root_solve_minutes: Mapped[int | None] = mapped_column(Integer)
    rating_avg: Mapped[Decimal | None] = mapped_column(Numeric(3, 2))
    rating_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Lifecycle
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft")
    creator_id: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))
    reviewer_id: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    retired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Tier gating
    required_tier: Mapped[str] = mapped_column(String(16), nullable=False, default="free")

    # Content
    cover_image_url: Mapped[str | None] = mapped_column(Text)
    intro_markdown: Mapped[str | None] = mapped_column(Text)
    walkthrough_markdown: Mapped[str | None] = mapped_column(Text)
    has_user_flag: Mapped[bool] = mapped_column(nullable=False, default=True)
    has_root_flag: Mapped[bool] = mapped_column(nullable=False, default=True)

    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSONB, nullable=False, default=dict, server_default="{}"
    )

    # Relationships
    tags: Mapped[list["MachineTag"]] = relationship(
        back_populates="machine", cascade="all, delete-orphan", lazy="selectin"
    )
    hints: Mapped[list["MachineHint"]] = relationship(
        back_populates="machine", cascade="all, delete-orphan", lazy="selectin"
    )


class MachineTag(Base):
    __tablename__ = "machine_tags"
    __table_args__ = {"schema": "content"}

    machine_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("content.machines.id", ondelete="CASCADE"),
        primary_key=True,
    )
    tag_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("content.tags.id", ondelete="CASCADE"),
        primary_key=True,
    )

    machine: Mapped[Machine] = relationship(back_populates="tags")
    tag: Mapped[Tag] = relationship(lazy="joined")


class MachineHint(Base, TimestampMixin):
    """Hints unlocked progressively by paying a point penalty."""

    __tablename__ = "machine_hints"
    __table_args__ = {"schema": "content"}

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    machine_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("content.machines.id", ondelete="CASCADE"),
        nullable=False,
    )
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    content_markdown: Mapped[str] = mapped_column(Text, nullable=False)
    point_penalty: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    flag_type: Mapped[str | None] = mapped_column(String(16))  # user|root|null

    machine: Mapped[Machine] = relationship(back_populates="hints")


class MachineRating(Base, TimestampMixin):
    __tablename__ = "machine_ratings"
    __table_args__ = (
        UniqueConstraint("user_id", "machine_id", name="uq_machine_rating"),
        {"schema": "content"},
    )

    user_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True)
    machine_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("content.machines.id", ondelete="CASCADE"),
        primary_key=True,
    )
    rating: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    difficulty_vote: Mapped[str | None] = mapped_column(String(16))
    comment: Mapped[str | None] = mapped_column(Text)


# =============================================================================
# Challenges
# =============================================================================


class Challenge(Base, TimestampMixin):
    __tablename__ = "challenges"
    __table_args__ = {"schema": "content"}

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    slug: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    category_id: Mapped[UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("content.categories.id", ondelete="SET NULL")
    )
    difficulty: Mapped[str] = mapped_column(String(16), nullable=False)
    points: Mapped[int] = mapped_column(Integer, nullable=False)

    # Instance config
    requires_instance: Mapped[bool] = mapped_column(nullable=False, default=False)
    image_ref: Mapped[str | None] = mapped_column(Text)
    expected_ports: Mapped[list[int]] = mapped_column(
        ARRAY(Integer), nullable=False, default=list, server_default="{}"
    )
    cpu_request: Mapped[str | None] = mapped_column(String(16), default="250m")
    memory_request: Mapped[str | None] = mapped_column(String(16), default="256Mi")

    # Downloadable artifacts
    files: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, default=list, server_default="[]"
    )

    # Lifecycle
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft")
    creator_id: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    retired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    required_tier: Mapped[str] = mapped_column(String(16), nullable=False, default="free")

    # Stats
    total_solves: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    avg_solve_minutes: Mapped[int | None] = mapped_column(Integer)
    rating_avg: Mapped[Decimal | None] = mapped_column(Numeric(3, 2))
    rating_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Content
    cover_image_url: Mapped[str | None] = mapped_column(Text)
    intro_markdown: Mapped[str | None] = mapped_column(Text)
    walkthrough_markdown: Mapped[str | None] = mapped_column(Text)

    tags: Mapped[list["ChallengeTag"]] = relationship(
        back_populates="challenge", cascade="all, delete-orphan", lazy="selectin"
    )


class ChallengeTag(Base):
    __tablename__ = "challenge_tags"
    __table_args__ = {"schema": "content"}

    challenge_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("content.challenges.id", ondelete="CASCADE"),
        primary_key=True,
    )
    tag_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("content.tags.id", ondelete="CASCADE"),
        primary_key=True,
    )

    challenge: Mapped[Challenge] = relationship(back_populates="tags")
    tag: Mapped[Tag] = relationship(lazy="joined")
