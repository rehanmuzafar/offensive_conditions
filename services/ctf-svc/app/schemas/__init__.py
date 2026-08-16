"""Pydantic v2 schemas — request bodies and response models."""

from __future__ import annotations

from datetime import datetime
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
# Events
# =============================================================================


EventFormat = Literal["jeopardy", "attack_defense", "hybrid", "king_of_hill"]
EventVisibility = Literal["public", "private", "invite_only"]
EventStatus = Literal["draft", "published", "registration", "live", "ended", "archived"]
Tier = Literal["free", "vip", "vip_plus"]
ChallengeDifficulty = Literal["very_easy", "easy", "medium", "hard", "insane"]


class PrizeTier(BaseModel):
    rank: int = Field(ge=1, le=100)
    prize_description: str
    amount: float | None = None
    currency: str | None = None


class EventCreate(BaseModel):
    slug: str = Field(pattern=r"^[a-z0-9-]{2,64}$")
    name: str = Field(min_length=3, max_length=200)
    description: str | None = None
    overview_markdown: str | None = None
    format: EventFormat = "jeopardy"
    visibility: EventVisibility = "public"
    team_play: bool = True
    solo_play: bool = True
    max_team_size: int | None = Field(default=4, ge=1, le=20)
    registration_starts_at: datetime
    registration_ends_at: datetime
    starts_at: datetime
    ends_at: datetime
    scoreboard_freeze_at: datetime | None = None
    dynamic_scoring: bool = True
    min_points: int = Field(default=50, ge=0, le=10_000)
    first_blood_bonus: int = Field(default=0, ge=0)
    required_tier: Tier = "free"
    # 0 = free event. Above 0 makes registration payment-gated.
    entry_fee_cents: int = Field(default=0, ge=0)
    currency: str = Field(default="USD", min_length=3, max_length=8)
    refund_policy: str | None = None
    # Where per-player spawns run. Static and shared-host challenges work
    # regardless of this setting.
    challenge_runtime: Literal["cloud", "onsite", "static_only"] = "static_only"
    scoreboard_visibility: Literal["public", "participants", "hidden"] = "public"
    invitation_only: bool = False
    invitation_code: str | None = None
    max_participants: int | None = Field(default=None, ge=1)
    prize_pool: list[PrizeTier] = Field(default_factory=list)
    cover_image_url: str | None = None
    rules_markdown: str | None = None
    sponsor_info: dict[str, Any] = Field(default_factory=dict)

    @field_validator("registration_ends_at")
    @classmethod
    def _reg_order(cls, v: datetime, info: Any) -> datetime:
        starts = info.data.get("registration_starts_at")
        if starts and v <= starts:
            raise ValueError("registration_ends_at must be after registration_starts_at")
        return v

    @field_validator("starts_at")
    @classmethod
    def _starts_after_reg_ends(cls, v: datetime, info: Any) -> datetime:
        reg_ends = info.data.get("registration_ends_at")
        if reg_ends and v < reg_ends:
            raise ValueError("starts_at must be at or after registration_ends_at")
        return v

    @field_validator("ends_at")
    @classmethod
    def _ends_after_starts(cls, v: datetime, info: Any) -> datetime:
        starts = info.data.get("starts_at")
        if starts and v <= starts:
            raise ValueError("ends_at must be after starts_at")
        return v


class EventUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=3, max_length=200)
    description: str | None = None
    overview_markdown: str | None = None
    visibility: EventVisibility | None = None
    max_team_size: int | None = Field(default=None, ge=1, le=20)
    scoreboard_freeze_at: datetime | None = None
    min_points: int | None = None
    first_blood_bonus: int | None = None
    max_participants: int | None = None
    prize_pool: list[PrizeTier] | None = None
    cover_image_url: str | None = None
    rules_markdown: str | None = None
    sponsor_info: dict[str, Any] | None = None
    invitation_code: str | None = None
    entry_fee_cents: int | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, min_length=3, max_length=8)
    refund_policy: str | None = None
    challenge_runtime: Literal["cloud", "onsite", "static_only"] | None = None
    scoreboard_visibility: Literal["public", "participants", "hidden"] | None = None
    # Editable after creation so an organiser can push the schedule out.
    starts_at: datetime | None = None
    registration_starts_at: datetime | None = None
    # Schedule extension only allowed before start
    registration_ends_at: datetime | None = None
    ends_at: datetime | None = None


class EventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    slug: str
    name: str
    description: str | None = None
    overview_markdown: str | None = None
    format: str
    visibility: str
    team_play: bool
    solo_play: bool
    max_team_size: int | None = None
    registration_starts_at: datetime
    registration_ends_at: datetime
    starts_at: datetime
    ends_at: datetime
    scoreboard_freeze_at: datetime | None = None
    dynamic_scoring: bool
    min_points: int
    first_blood_bonus: int
    required_tier: str
    entry_fee_cents: int = 0
    currency: str = "USD"
    refund_policy: str | None = None
    challenge_runtime: str = "static_only"
    scoreboard_visibility: str = "public"
    invitation_only: bool
    max_participants: int | None = None
    prize_pool: list[dict[str, Any]] = Field(default_factory=list)
    status: str
    cover_image_url: str | None = None
    rules_markdown: str | None = None
    sponsor_info: dict[str, Any] = Field(default_factory=dict)
    total_registered: int
    total_teams: int
    challenge_count: int = 0
    created_by: UUID
    created_at: datetime
    updated_at: datetime


class EventList(BaseModel):
    items: list[EventRead]
    meta: PageMeta


# =============================================================================
# Challenges within an event
# =============================================================================


class ChallengeFile(BaseModel):
    name: str
    url: str
    size_bytes: int
    sha256: str


class ChallengeHint(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    text: str = Field(min_length=1, max_length=2000)
    point_deduction: int = Field(ge=0, le=10_000)


class EventChallengeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    category: str = Field(min_length=1, max_length=64)
    difficulty: ChallengeDifficulty | None = None
    description: str
    base_points: int = Field(ge=10, le=100_000)
    # static      — file/offline challenge, no service
    # shared_host — one instance everyone attacks (connection_url required)
    # per_player  — spawned on demand (image_ref required)
    delivery_type: Literal["static", "shared_host", "per_player"] = "static"
    connection_url: str | None = Field(default=None, max_length=500)
    requires_instance: bool = False
    image_ref: str | None = None
    files: list[ChallengeFile] = Field(default_factory=list)
    static_flag_hash: str | None = Field(default=None, max_length=128)
    flag_pattern: str | None = Field(default=None, max_length=200)
    unlocks_at: datetime | None = None
    requires_solving_ids: list[UUID] = Field(default_factory=list)
    hints: list[ChallengeHint] = Field(default_factory=list)
    sort_order: int = 0
    is_hidden: bool = False


class EventChallengeUpdate(BaseModel):
    name: str | None = None
    category: str | None = None
    difficulty: ChallengeDifficulty | None = None
    description: str | None = None
    base_points: int | None = Field(default=None, ge=10, le=100_000)
    delivery_type: Literal["static", "shared_host", "per_player"] | None = None
    connection_url: str | None = Field(default=None, max_length=500)
    requires_instance: bool | None = None
    image_ref: str | None = None
    files: list[ChallengeFile] | None = None
    static_flag_hash: str | None = None
    flag_pattern: str | None = None
    unlocks_at: datetime | None = None
    requires_solving_ids: list[UUID] | None = None
    hints: list[ChallengeHint] | None = None
    sort_order: int | None = None
    is_hidden: bool | None = None


class EventChallengeRead(BaseModel):
    """Public view — hides flag hash + secrets."""

    model_config = ConfigDict(from_attributes=True)
    id: UUID
    event_id: UUID
    name: str
    category: str
    difficulty: str | None = None
    description: str
    base_points: int
    current_points: int
    delivery_type: str = "static"
    # Present for shared-host challenges — the address players attack.
    connection_url: str | None = None
    requires_instance: bool
    image_ref: str | None = None
    files: list[dict[str, Any]] = Field(default_factory=list)
    unlocks_at: datetime | None = None
    requires_solving_ids: list[UUID] = Field(default_factory=list)
    # hints: only IDs + deductions visible until unlocked
    hint_summaries: list[dict[str, Any]] = Field(default_factory=list)
    total_solves: int
    first_blood_user_id: UUID | None = None
    first_blood_team_id: UUID | None = None
    first_blood_at: datetime | None = None
    sort_order: int
    is_solved: bool = False  # populated per-viewer


class EventChallengeOrganizerRead(EventChallengeRead):
    """Organizer view — includes secret fields."""
    static_flag_hash: str | None = None
    flag_pattern: str | None = None
    hints: list[dict[str, Any]] = Field(default_factory=list)
    is_hidden: bool


class EventChallengeList(BaseModel):
    items: list[EventChallengeRead]


# =============================================================================
# Registration + participation
# =============================================================================


class SoloRegistration(BaseModel):
    """All fields optional: joining a public solo event carries no payload."""

    invitation_code: str | None = None
    # Required on a team event: which of the caller's teams they play for.
    team_id: UUID | None = None


class TeamRegistration(BaseModel):
    team_id: UUID
    invitation_code: str | None = None


class ParticipantRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    event_id: UUID
    participant_type: str
    user_id: UUID | None = None
    team_id: UUID | None = None
    team_name_at_event: str | None = None
    points: int
    solve_count: int
    last_solve_at: datetime | None = None
    rank: int | None = None
    is_disqualified: bool
    registered_at: datetime


class LeaderboardEntry(BaseModel):
    rank: int
    participant_id: UUID
    participant_type: str
    user_id: UUID | None = None
    team_id: UUID | None = None
    display_name: str
    points: int
    solve_count: int
    last_solve_at: datetime | None = None
    # ISO alpha-2, joined from the team record; null for solo entries.
    country_code: str | None = None
    first_bloods: int = 0


class LeaderboardResponse(BaseModel):
    event_id: UUID
    frozen: bool
    generated_at: datetime
    entries: list[LeaderboardEntry]


# =============================================================================
# Submission
# =============================================================================


class FlagSubmitRequest(BaseModel):
    flag: str = Field(min_length=1, max_length=512)


class FlagSubmitResponse(BaseModel):
    accepted: bool
    message: str
    is_first_blood: bool = False
    points_awarded: int = 0
    new_total_points: int = 0
    new_rank: int | None = None


# =============================================================================
# Hints
# =============================================================================


class HintUnlockRequest(BaseModel):
    hint_id: str


class HintUnlockResponse(BaseModel):
    hint_id: str
    text: str
    point_deduction: int


# =============================================================================
# Announcements
# =============================================================================


class AnnouncementCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=4000)
    is_pinned: bool = False
    challenge_id: UUID | None = None


class AnnouncementRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    event_id: UUID
    posted_by: UUID
    title: str
    body: str
    is_pinned: bool
    challenge_id: UUID | None = None
    created_at: datetime


# =============================================================================
# Disqualification
# =============================================================================


class DisqualifyRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)
