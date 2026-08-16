"""Pydantic schemas."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class PageMeta(BaseModel):
    total: int
    limit: int
    offset: int
    has_more: bool


ContentType = Literal["machine", "challenge", "dojo_level", "pro_lab"]
WriteupStatus = Literal["pending", "approved", "rejected", "archived"]
VoteDirection = Literal["up", "down", "clear"]


# =============================================================================
# Writeups
# =============================================================================


class WriteupCreate(BaseModel):
    content_type: ContentType
    content_id: UUID
    title: str = Field(min_length=3, max_length=200)
    summary: str | None = Field(default=None, max_length=500)
    content_markdown: str = Field(min_length=100, max_length=200_000)
    language: str = Field(default="en", pattern=r"^[a-z]{2}(-[a-z]{2,4})?$")
    video_url: str | None = None
    cover_image_url: str | None = None
    tags: list[str] = Field(default_factory=list, max_length=15)
    techniques_used: list[str] = Field(default_factory=list, max_length=20)
    tools_used: list[str] = Field(default_factory=list, max_length=20)
    contains_full_solution: bool = True
    spoiler_warning_shown: bool = True


class WriteupUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=3, max_length=200)
    summary: str | None = Field(default=None, max_length=500)
    content_markdown: str | None = Field(default=None, min_length=100, max_length=200_000)
    video_url: str | None = None
    cover_image_url: str | None = None
    tags: list[str] | None = None
    techniques_used: list[str] | None = None
    tools_used: list[str] | None = None
    contains_full_solution: bool | None = None


class WriteupRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    author_id: UUID
    content_type: str
    content_id: UUID
    title: str
    slug: str
    summary: str | None = None
    language: str
    word_count: int | None = None
    read_time_minutes: int | None = None
    has_video: bool
    video_url: str | None = None
    cover_image_url: str | None = None
    tags: list[str] = Field(default_factory=list)
    techniques_used: list[str] = Field(default_factory=list)
    tools_used: list[str] = Field(default_factory=list)
    status: str
    is_featured: bool
    featured_at: datetime | None = None
    view_count: int
    upvote_count: int
    downvote_count: int
    score: int
    bookmark_count: int
    comment_count: int
    rating_avg: Decimal | None = None
    rating_count: int
    contains_full_solution: bool
    spoiler_warning_shown: bool
    published_at: datetime | None = None
    created_at: datetime


class WriteupDetailRead(WriteupRead):
    """Full content_markdown + content_html, gated."""
    content_markdown: str
    content_html: str | None = None


class WriteupOrganizerRead(WriteupRead):
    """Mod view — includes rejection_reason + moderator_id."""
    moderator_id: UUID | None = None
    rejection_reason: str | None = None
    moderated_at: datetime | None = None


class WriteupList(BaseModel):
    items: list[WriteupRead]
    meta: PageMeta


# =============================================================================
# Comments
# =============================================================================


class CommentCreate(BaseModel):
    content_markdown: str = Field(min_length=1, max_length=10_000)
    parent_comment_id: UUID | None = None


class CommentUpdate(BaseModel):
    content_markdown: str = Field(min_length=1, max_length=10_000)


class CommentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    writeup_id: UUID
    author_id: UUID
    parent_comment_id: UUID | None = None
    content_markdown: str
    content_html: str | None = None
    is_deleted: bool
    is_edited: bool
    edit_count: int
    upvote_count: int
    downvote_count: int
    score: int
    edited_at: datetime | None = None
    created_at: datetime


class CommentList(BaseModel):
    items: list[CommentRead]
    meta: PageMeta


# =============================================================================
# Votes
# =============================================================================


class VoteCast(BaseModel):
    direction: VoteDirection


class VoteResult(BaseModel):
    target_id: UUID
    upvote_count: int
    downvote_count: int
    score: int
    my_vote: int  # +1 / -1 / 0


# =============================================================================
# Bookmarks
# =============================================================================


class BookmarkCreate(BaseModel):
    note: str | None = Field(default=None, max_length=2000)


class BookmarkRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    writeup_id: UUID
    user_id: UUID
    note: str | None = None
    created_at: datetime


# =============================================================================
# Moderation
# =============================================================================


class RejectAction(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)


class FeatureToggle(BaseModel):
    featured: bool = True
