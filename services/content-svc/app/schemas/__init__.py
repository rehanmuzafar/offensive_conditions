"""Pydantic v2 schemas — request bodies and response models."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


# =============================================================================
# Common
# =============================================================================


class PageMeta(BaseModel):
    total: int
    limit: int
    offset: int
    has_more: bool


# =============================================================================
# Tags + categories
# =============================================================================


class TagRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    slug: str
    name: str
    color: str | None = None


class CategoryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    slug: str
    name: str
    description: str | None = None
    parent_id: UUID | None = None
    icon: str | None = None


# =============================================================================
# Machine
# =============================================================================


Difficulty = Literal["very_easy", "easy", "medium", "hard", "insane"]
OS = Literal["linux", "windows", "other", "bsd", "macos"]
MachineStatus = Literal["draft", "review", "active", "retired", "archived"]
Tier = Literal["free", "vip", "vip_plus"]
Backend = Literal["container", "vm"]
#: How a player reaches the box. `backend` answers a different question — which
#: provisioner brings it up — and only means anything for `spawn`.
Delivery = Literal["spawn", "static_host", "download"]


class MachineCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    slug: str = Field(pattern=r"^[a-z0-9-]{2,64}$")
    description: str | None = None
    os: OS
    difficulty: Difficulty
    category_id: UUID | None = None
    backend: Backend = "container"
    delivery: Delivery = "spawn"
    #: Required for `spawn`, meaningless otherwise — two of the three kinds
    #: have no image at all.
    image_ref: str | None = Field(default=None, max_length=400)
    image_version: str | None = Field(default=None, max_length=64)
    #: `static_host`: the always-on host players attack.
    static_host: str | None = Field(default=None, max_length=255)
    #: `download`: the boot2root artefact and enough to verify it.
    download_url: str | None = Field(default=None, max_length=600)
    download_sha256: str | None = Field(default=None, max_length=64)
    download_size_bytes: int | None = Field(default=None, ge=0)
    download_format: str | None = Field(default=None, max_length=32)
    cpu_request: str = "500m"
    memory_request: str = "512Mi"
    cpu_limit: str = "1000m"
    memory_limit: str = "1Gi"
    disk_gb: int = Field(default=10, ge=1, le=200)
    expected_ports: list[int] = Field(default_factory=list)
    base_user_points: int = Field(default=0, ge=0, le=100_000)
    base_root_points: int = Field(default=0, ge=0, le=100_000)
    base_challenge_points: int = Field(default=0, ge=0, le=100_000)
    required_tier: Tier = "free"
    cover_image_url: str | None = None
    intro_markdown: str | None = None
    has_user_flag: bool = True
    has_root_flag: bool = True
    tags: list[UUID] = Field(default_factory=list)

    @field_validator("expected_ports")
    @classmethod
    def _validate_ports(cls, v: list[int]) -> list[int]:
        for p in v:
            if not (1 <= p <= 65535):
                raise ValueError(f"invalid port: {p}")
        return v


class MachineUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    os: OS | None = None
    difficulty: Difficulty | None = None
    category_id: UUID | None = None
    delivery: Delivery | None = None
    image_ref: str | None = None
    image_version: str | None = None
    static_host: str | None = Field(default=None, max_length=255)
    download_url: str | None = Field(default=None, max_length=600)
    download_sha256: str | None = Field(default=None, max_length=64)
    download_size_bytes: int | None = Field(default=None, ge=0)
    download_format: str | None = Field(default=None, max_length=32)
    cpu_request: str | None = None
    memory_request: str | None = None
    cpu_limit: str | None = None
    memory_limit: str | None = None
    disk_gb: int | None = Field(default=None, ge=1, le=200)
    expected_ports: list[int] | None = None
    base_user_points: int | None = Field(default=None, ge=0, le=100_000)
    base_root_points: int | None = Field(default=None, ge=0, le=100_000)
    base_challenge_points: int | None = Field(default=None, ge=0, le=100_000)
    required_tier: Tier | None = None
    cover_image_url: str | None = None
    intro_markdown: str | None = None
    walkthrough_markdown: str | None = None
    has_user_flag: bool | None = None
    has_root_flag: bool | None = None
    tags: list[UUID] | None = None


class MachineRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    slug: str
    name: str
    description: str | None = None

    os: str
    difficulty: str
    category_id: UUID | None = None

    backend: str
    delivery: str = "spawn"
    image_ref: str | None = None
    image_version: str | None = None
    static_host: str | None = None
    download_url: str | None = None
    download_sha256: str | None = None
    download_size_bytes: int | None = None
    download_format: str | None = None
    expected_ports: list[int] = Field(default_factory=list)
    disk_gb: int

    base_user_points: int
    base_root_points: int
    base_challenge_points: int

    total_user_owns: int
    total_root_owns: int
    avg_user_solve_minutes: int | None = None
    avg_root_solve_minutes: int | None = None
    rating_avg: Decimal | None = None
    rating_count: int

    status: str
    creator_id: UUID | None = None
    released_at: datetime | None = None
    retired_at: datetime | None = None
    required_tier: str

    cover_image_url: str | None = None
    intro_markdown: str | None = None
    walkthrough_markdown: str | None = None
    has_user_flag: bool
    has_root_flag: bool

    created_at: datetime
    updated_at: datetime
    tags: list[TagRead] = Field(default_factory=list)

    @field_validator("tags", mode="before")
    @classmethod
    def _flatten_tags(cls, v: Any) -> Any:
        # Convert MachineTag relationship rows into Tag dicts.
        if v and not isinstance(v[0], (dict, TagRead)):
            return [item.tag for item in v if hasattr(item, "tag")]
        return v


class MachineList(BaseModel):
    items: list[MachineRead]
    meta: PageMeta


class MachineStatsRead(BaseModel):
    total_user_owns: int
    total_root_owns: int
    avg_user_solve_minutes: int | None
    avg_root_solve_minutes: int | None
    rating_avg: Decimal | None
    rating_count: int
    difficulty_distribution: dict[str, int] = Field(default_factory=dict)


# =============================================================================
# Ratings
# =============================================================================


class MachineRate(BaseModel):
    rating: int = Field(ge=1, le=5)
    difficulty_vote: Difficulty | None = None
    comment: str | None = Field(default=None, max_length=5000)


class MachineReviewRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    user_id: UUID
    machine_id: UUID
    rating: int
    difficulty_vote: str | None = None
    comment: str | None = None
    created_at: datetime
    updated_at: datetime


# =============================================================================
# Challenge
# =============================================================================


ChallengeStatus = Literal["draft", "review", "active", "retired", "archived"]


class ChallengeFile(BaseModel):
    name: str
    url: str
    size_bytes: int
    sha256: str


class ChallengeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    slug: str = Field(pattern=r"^[a-z0-9-]{2,64}$")
    description: str
    category_id: UUID | None = None
    difficulty: Difficulty
    points: int = Field(ge=0, le=100_000)
    requires_instance: bool = False
    image_ref: str | None = None
    expected_ports: list[int] = Field(default_factory=list)
    files: list[ChallengeFile] = Field(default_factory=list)
    required_tier: Tier = "free"
    cover_image_url: str | None = None
    intro_markdown: str | None = None
    tags: list[UUID] = Field(default_factory=list)


class ChallengeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    category_id: UUID | None = None
    difficulty: Difficulty | None = None
    points: int | None = Field(default=None, ge=0, le=100_000)
    requires_instance: bool | None = None
    image_ref: str | None = None
    expected_ports: list[int] | None = None
    files: list[ChallengeFile] | None = None
    required_tier: Tier | None = None
    cover_image_url: str | None = None
    intro_markdown: str | None = None
    walkthrough_markdown: str | None = None
    tags: list[UUID] | None = None


class ChallengeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    slug: str
    name: str
    description: str
    category_id: UUID | None = None
    difficulty: str
    points: int
    requires_instance: bool
    image_ref: str | None = None
    expected_ports: list[int] = Field(default_factory=list)
    files: list[dict[str, Any]] = Field(default_factory=list)
    status: str
    creator_id: UUID | None = None
    released_at: datetime | None = None
    retired_at: datetime | None = None
    required_tier: str
    total_solves: int
    avg_solve_minutes: int | None = None
    rating_avg: Decimal | None = None
    rating_count: int
    cover_image_url: str | None = None
    intro_markdown: str | None = None
    walkthrough_markdown: str | None = None
    created_at: datetime
    updated_at: datetime
    tags: list[TagRead] = Field(default_factory=list)

    @field_validator("tags", mode="before")
    @classmethod
    def _flatten_tags(cls, v: Any) -> Any:
        if v and not isinstance(v[0], (dict, TagRead)):
            return [item.tag for item in v if hasattr(item, "tag")]
        return v


class ChallengeList(BaseModel):
    items: list[ChallengeRead]
    meta: PageMeta


# =============================================================================
# Learning paths
# =============================================================================


PathDifficulty = Literal["beginner", "intermediate", "advanced", "expert"]


class PathRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    slug: str
    name: str
    description: str | None = None
    overview_markdown: str | None = None
    difficulty: str
    category_id: UUID | None = None
    estimated_hours: int | None = None
    module_count: int
    machine_count: int
    challenge_count: int
    total_completions: int
    total_enrollments: int
    rating_avg: Decimal | None = None
    rating_count: int
    required_tier: str
    status: str
    creator_id: UUID | None = None
    released_at: datetime | None = None
    cover_image_url: str | None = None
    completion_certificate: bool
    completion_points: int
    completion_badge_id: UUID | None = None


class PathList(BaseModel):
    items: list[PathRead]
    meta: PageMeta


class PathModuleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    path_id: UUID
    sequence: int
    title: str
    description: str | None = None
    estimated_minutes: int | None = None
    machine_id: UUID | None = None
    challenge_id: UUID | None = None
    is_optional: bool
    requires_previous: bool
    completion_points: int
    # content_markdown not included by default — fetch via separate endpoint to keep list lightweight


class PathDetailRead(PathRead):
    modules: list[PathModuleRead] = Field(default_factory=list)


class PathEnrollmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    user_id: UUID
    path_id: UUID
    status: str
    progress_percent: int
    completed_at: datetime | None = None
    last_activity_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class PathProgressRead(BaseModel):
    enrollment: PathEnrollmentRead
    modules_completed: int
    modules_total: int
    next_module_id: UUID | None = None


class ModuleCompleteRequest(BaseModel):
    """User submits answers to a module's questions."""
    answers: dict[str, str] = Field(default_factory=dict)  # question_id → answer


class ModuleCompleteResponse(BaseModel):
    module_id: UUID
    completed: bool
    correct_answers: int
    total_questions: int
    points_earned: int


# =============================================================================
# Search
# =============================================================================


SearchType = Literal["machine", "challenge", "path", "all"]


class SearchHit(BaseModel):
    """One result from the unified search endpoint."""
    type: str  # "machine" | "challenge" | "path"
    id: UUID
    slug: str
    name: str
    description: str | None = None
    difficulty: str
    cover_image_url: str | None = None
    rating_avg: Decimal | None = None


class SearchResponse(BaseModel):
    query: str
    total: int
    hits: list[SearchHit]
    facets: dict[str, dict[str, int]] = Field(default_factory=dict)
