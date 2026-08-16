"""ORM models matching the forum schema."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import (
    ARRAY,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import INET, JSONB, UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class Category(Base, TimestampMixin):
    __tablename__ = "categories"
    __table_args__ = {"schema": "forum"}

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    slug: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    parent_id: Mapped[UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("forum.categories.id", ondelete="SET NULL")
    )
    icon: Mapped[str | None] = mapped_column(String(64))
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_locked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    required_tier: Mapped[str] = mapped_column(String(16), nullable=False, default="free")
    thread_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class Thread(Base, TimestampMixin):
    __tablename__ = "threads"
    __table_args__ = {"schema": "forum"}

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    category_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("forum.categories.id"),
        nullable=False,
    )
    author_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    slug: Mapped[str] = mapped_column(Text, nullable=False)

    status: Mapped[str] = mapped_column(String(16), nullable=False, default="open")
    is_pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_announcement: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_solved: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    solved_post_id: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))

    view_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    reply_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    unique_posters: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    last_post_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="NOW()"
    )
    last_post_user_id: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))

    related_machine_id: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))
    related_challenge_id: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))

    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSONB, nullable=False, default=dict, server_default="{}"
    )
    tags: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, default=list, server_default="{}"
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Post(Base):
    __tablename__ = "posts"
    __table_args__ = {"schema": "forum"}

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    thread_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("forum.threads.id", ondelete="CASCADE"),
        nullable=False,
    )
    author_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    parent_post_id: Mapped[UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("forum.posts.id")
    )

    content_markdown: Mapped[str] = mapped_column(Text, nullable=False)
    content_html: Mapped[str | None] = mapped_column(Text)

    is_first_post: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_edited: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    edit_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    upvote_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    downvote_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    mentioned_users: Mapped[list[UUID]] = mapped_column(
        ARRAY(PgUUID(as_uuid=True)), nullable=False, default=list, server_default="{}"
    )
    contains_spoilers: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    ip_address: Mapped[str | None] = mapped_column(INET)
    user_agent: Mapped[str | None] = mapped_column(Text)
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    edited_by: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="NOW()"
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_by: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))


class PostVote(Base):
    __tablename__ = "post_votes"
    __table_args__ = (
        UniqueConstraint("post_id", "user_id", name="uq_post_vote"),
        {"schema": "forum"},
    )

    post_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("forum.posts.id", ondelete="CASCADE"),
        primary_key=True,
    )
    user_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True)
    direction: Mapped[int] = mapped_column(SmallInteger, nullable=False)  # +1 / -1
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="NOW()"
    )


class ThreadSubscription(Base):
    __tablename__ = "thread_subscriptions"
    __table_args__ = (
        UniqueConstraint("thread_id", "user_id", name="uq_thread_subscription"),
        {"schema": "forum"},
    )

    thread_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("forum.threads.id", ondelete="CASCADE"),
        primary_key=True,
    )
    user_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True)
    email_notifications: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    in_app_notifications: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    subscribed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="NOW()"
    )


class UserReputation(Base):
    __tablename__ = "user_reputation"
    __table_args__ = {"schema": "forum"}

    user_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True)
    reputation: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    upvotes_received: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    downvotes_received: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    posts_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    threads_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    solutions_accepted: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_recomputed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="NOW()"
    )


class Report(Base):
    __tablename__ = "reports"
    __table_args__ = {"schema": "forum"}

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    reporter_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    target_type: Mapped[str] = mapped_column(String(16), nullable=False)  # post|thread|user
    target_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    reason: Mapped[str] = mapped_column(String(64), nullable=False)
    details: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="open")  # open|reviewing|resolved|dismissed
    resolved_by: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))
    resolution_note: Mapped[str | None] = mapped_column(Text)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="NOW()"
    )
