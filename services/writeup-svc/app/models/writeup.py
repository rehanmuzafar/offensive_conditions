"""ORM models matching the writeup schema."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import (
    ARRAY,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Writeup(Base):
    __tablename__ = "writeups"
    __table_args__ = {"schema": "writeup"}

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    author_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)

    content_type: Mapped[str] = mapped_column(String(32), nullable=False)
    content_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)

    title: Mapped[str] = mapped_column(Text, nullable=False)
    slug: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    summary: Mapped[str | None] = mapped_column(Text)
    content_markdown: Mapped[str] = mapped_column(Text, nullable=False)
    content_html: Mapped[str | None] = mapped_column(Text)
    language: Mapped[str] = mapped_column(String(8), nullable=False, default="en")

    word_count: Mapped[int | None] = mapped_column(Integer)
    read_time_minutes: Mapped[int | None] = mapped_column(Integer)
    has_video: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    video_url: Mapped[str | None] = mapped_column(Text)
    cover_image_url: Mapped[str | None] = mapped_column(Text)

    tags: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, default=list, server_default="{}"
    )
    techniques_used: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, default=list, server_default="{}"
    )
    tools_used: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, default=list, server_default="{}"
    )

    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    moderator_id: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))
    rejection_reason: Mapped[str | None] = mapped_column(Text)
    moderated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    is_featured: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    featured_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    featured_by: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))

    view_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    unique_view_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    upvote_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    downvote_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    bookmark_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    comment_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rating_avg: Mapped[Decimal | None] = mapped_column(Numeric(3, 2))
    rating_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    contains_full_solution: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    spoiler_warning_shown: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSONB, nullable=False, default=dict, server_default="{}"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="NOW()"
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="NOW()"
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Vote(Base):
    __tablename__ = "votes"
    __table_args__ = (
        UniqueConstraint("writeup_id", "user_id", name="uq_writeup_vote"),
        {"schema": "writeup"},
    )

    writeup_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("writeup.writeups.id", ondelete="CASCADE"),
        primary_key=True,
    )
    user_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True)
    direction: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="NOW()"
    )


class Bookmark(Base):
    __tablename__ = "bookmarks"
    __table_args__ = (
        UniqueConstraint("writeup_id", "user_id", name="uq_writeup_bookmark"),
        {"schema": "writeup"},
    )

    writeup_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("writeup.writeups.id", ondelete="CASCADE"),
        primary_key=True,
    )
    user_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True)
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="NOW()"
    )


class Comment(Base):
    __tablename__ = "comments"
    __table_args__ = {"schema": "writeup"}

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    writeup_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("writeup.writeups.id", ondelete="CASCADE"),
        nullable=False,
    )
    author_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    parent_comment_id: Mapped[UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("writeup.comments.id")
    )

    content_markdown: Mapped[str] = mapped_column(Text, nullable=False)
    content_html: Mapped[str | None] = mapped_column(Text)

    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_edited: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    edit_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    upvote_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    downvote_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    edited_by: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="NOW()"
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_by: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))


class CommentVote(Base):
    """Per-comment vote tracking — added by ctf-svc migration alongside the
    Phase 2 schema since the Phase 2 writeup schema only has writeup-level
    votes. We need this for fine-grained comment voting.
    """

    __tablename__ = "comment_votes"
    __table_args__ = (
        UniqueConstraint("comment_id", "user_id", name="uq_comment_vote"),
        {"schema": "writeup"},
    )

    comment_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("writeup.comments.id", ondelete="CASCADE"),
        primary_key=True,
    )
    user_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True)
    direction: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="NOW()"
    )
