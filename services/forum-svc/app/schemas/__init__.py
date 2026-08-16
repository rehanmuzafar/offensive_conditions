"""Pydantic schemas for forum HTTP API."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class PageMeta(BaseModel):
    total: int
    limit: int
    offset: int
    has_more: bool


ThreadStatus = Literal["open", "closed", "locked", "archived", "deleted"]
Tier = Literal["free", "vip", "vip_plus"]


# =============================================================================
# Categories
# =============================================================================


class CategoryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    slug: str
    name: str
    description: str | None = None
    parent_id: UUID | None = None
    icon: str | None = None
    sort_order: int
    is_locked: bool
    required_tier: str
    thread_count: int


# =============================================================================
# Threads
# =============================================================================


class ThreadCreate(BaseModel):
    category_id: UUID
    title: str = Field(min_length=3, max_length=200)
    body_markdown: str = Field(min_length=1, max_length=60_000)
    tags: list[str] = Field(default_factory=list, max_length=10)
    related_machine_id: UUID | None = None
    related_challenge_id: UUID | None = None
    contains_spoilers: bool = False


class ThreadUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=3, max_length=200)
    tags: list[str] | None = Field(default=None, max_length=10)


class ThreadRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    category_id: UUID
    author_id: UUID
    title: str
    slug: str
    status: str
    is_pinned: bool
    is_announcement: bool
    is_solved: bool
    solved_post_id: UUID | None = None
    view_count: int
    reply_count: int
    unique_posters: int
    last_post_at: datetime
    last_post_user_id: UUID | None = None
    related_machine_id: UUID | None = None
    related_challenge_id: UUID | None = None
    tags: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class ThreadList(BaseModel):
    items: list[ThreadRead]
    meta: PageMeta


# =============================================================================
# Posts
# =============================================================================


class PostCreate(BaseModel):
    content_markdown: str = Field(min_length=1, max_length=60_000)
    parent_post_id: UUID | None = None
    contains_spoilers: bool = False


class PostUpdate(BaseModel):
    content_markdown: str = Field(min_length=1, max_length=60_000)
    contains_spoilers: bool | None = None


class PostRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    thread_id: UUID
    author_id: UUID
    parent_post_id: UUID | None = None
    content_markdown: str
    content_html: str | None = None
    is_first_post: bool
    is_deleted: bool
    is_edited: bool
    edit_count: int
    is_pinned: bool
    upvote_count: int
    downvote_count: int
    score: int
    contains_spoilers: bool
    edited_at: datetime | None = None
    created_at: datetime


class PostList(BaseModel):
    items: list[PostRead]
    meta: PageMeta


# =============================================================================
# Votes
# =============================================================================


VoteDirection = Literal["up", "down", "clear"]


class VoteCast(BaseModel):
    direction: VoteDirection


class VoteResult(BaseModel):
    post_id: UUID
    upvote_count: int
    downvote_count: int
    score: int
    my_vote: int  # +1, -1, or 0


# =============================================================================
# Subscriptions
# =============================================================================


class SubscriptionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    thread_id: UUID
    user_id: UUID
    email_notifications: bool
    in_app_notifications: bool
    subscribed_at: datetime


class SubscriptionToggle(BaseModel):
    email_notifications: bool = True
    in_app_notifications: bool = True


# =============================================================================
# Reputation
# =============================================================================


class ReputationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    user_id: UUID
    reputation: int
    upvotes_received: int
    downvotes_received: int
    posts_count: int
    threads_count: int
    solutions_accepted: int
    last_recomputed_at: datetime | None = None


# =============================================================================
# Reports
# =============================================================================


ReportReason = Literal[
    "spam",
    "harassment",
    "hate_speech",
    "off_topic",
    "self_promotion",
    "misinformation",
    "doxxing",
    "illegal_content",
    "other",
]


class ReportCreate(BaseModel):
    target_type: Literal["post", "thread", "user"]
    target_id: UUID
    reason: ReportReason
    details: str | None = Field(default=None, max_length=2000)


class ReportRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    reporter_id: UUID
    target_type: str
    target_id: UUID
    reason: str
    details: str | None = None
    status: str
    resolved_by: UUID | None = None
    resolution_note: str | None = None
    resolved_at: datetime | None = None
    created_at: datetime


class ReportResolve(BaseModel):
    action: Literal["dismiss", "remove_content", "warn_user", "ban_user"]
    note: str | None = Field(default=None, max_length=2000)
