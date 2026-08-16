"""Additional ctf-svc tables: announcements + hint unlocks + freeze snapshot.

These are added by Alembic migration 20260525_0001 on top of Phase 2 schema.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class EventAnnouncement(Base, TimestampMixin):
    """Organizer broadcast to all participants."""

    __tablename__ = "event_announcements"
    __table_args__ = {"schema": "ctf"}

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    event_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("ctf.events.id", ondelete="CASCADE"),
        nullable=False,
    )
    posted_by: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    is_pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    challenge_id: Mapped[UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("ctf.event_challenges.id", ondelete="SET NULL"),
    )


class HintUnlock(Base):
    """Records a participant unlocking a hint (with its point deduction)."""

    __tablename__ = "hint_unlocks"
    __table_args__ = (
        UniqueConstraint(
            "event_id", "challenge_id", "participant_id", "hint_id",
            name="uq_hint_unlock",
        ),
        {"schema": "ctf"},
    )

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    event_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("ctf.events.id", ondelete="CASCADE"),
        nullable=False,
    )
    challenge_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("ctf.event_challenges.id", ondelete="CASCADE"),
        nullable=False,
    )
    participant_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("ctf.event_participants.id", ondelete="CASCADE"),
        nullable=False,
    )
    hint_id: Mapped[str] = mapped_column(String(64), nullable=False)
    point_deduction: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    unlocked_by_user_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    unlocked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="NOW()"
    )


class FrozenScoreboard(Base):
    """Snapshot of the leaderboard at scoreboard_freeze_at.

    Public viewers see this from freeze onward; organizers always see live.
    """

    __tablename__ = "frozen_scoreboards"
    __table_args__ = {"schema": "ctf"}

    event_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("ctf.events.id", ondelete="CASCADE"),
        primary_key=True,
    )
    frozen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    snapshot: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, default=list, server_default="[]"
    )


class FlagSubmissionAttempt(Base):
    """Rate-limiting tracker for submission attempts."""

    __tablename__ = "flag_submission_attempts"
    __table_args__ = {"schema": "ctf"}

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    event_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("ctf.events.id", ondelete="CASCADE"),
        nullable=False,
    )
    challenge_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("ctf.event_challenges.id", ondelete="CASCADE"),
        nullable=False,
    )
    participant_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("ctf.event_participants.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    accepted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    submitted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="NOW()"
    )
