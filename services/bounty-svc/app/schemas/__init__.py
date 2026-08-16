"""Pydantic schemas for HTTP IO."""

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


Severity = Literal["critical", "high", "medium", "low", "informational"]
ProgramStatus = Literal["draft", "published", "paused", "closed"]
ProgramVisibility = Literal["public", "invite_only", "private"]
ReportState = Literal[
    "submitted", "triaging", "accepted", "rejected", "duplicate",
    "informational", "resolved", "paid", "closed",
]
PayoutState = Literal["requested", "processing", "paid", "failed", "canceled"]
AssetType = Literal[
    "domain", "wildcard", "ip", "ip_range", "mobile_app", "source_code", "api", "other"
]
DisclosurePolicy = Literal["coordinated", "none", "public"]


# =============================================================================
# Programs
# =============================================================================


class ScopeItem(BaseModel):
    asset_type: AssetType
    asset_identifier: str = Field(min_length=1, max_length=500)
    severity_max: Severity = "critical"
    in_scope: bool = True
    notes: str | None = Field(default=None, max_length=2000)


class RewardTier(BaseModel):
    severity: Severity
    min_cents: int = Field(ge=0)
    max_cents: int = Field(ge=0)
    currency: str = Field(default="USD", min_length=3, max_length=3)

    @field_validator("max_cents")
    @classmethod
    def _max_gte_min(cls, v: int, info: Any) -> int:
        mn = info.data.get("min_cents", 0)
        if v < mn:
            raise ValueError("max_cents must be >= min_cents")
        return v


class ProgramCreate(BaseModel):
    slug: str = Field(min_length=2, max_length=80, pattern=r"^[a-z0-9][a-z0-9_-]{1,79}$")
    name: str = Field(min_length=2, max_length=160)
    owner_org_id: UUID
    description: str = Field(min_length=1, max_length=20_000)
    policy: str = Field(min_length=1, max_length=50_000)
    visibility: ProgramVisibility = "public"
    currency: str = Field(default="USD", min_length=3, max_length=3)
    min_reward_cents: int | None = Field(default=None, ge=0)
    max_reward_cents: int | None = Field(default=None, ge=0)
    disclosure_policy: DisclosurePolicy = "coordinated"
    response_sla_hours: int = Field(default=72, ge=1, le=720)
    triage_sla_hours: int = Field(default=168, ge=1, le=2160)
    resolution_sla_days: int = Field(default=90, ge=1, le=365)
    in_scope_summary: str | None = Field(default=None, max_length=10_000)
    out_of_scope_summary: str | None = Field(default=None, max_length=10_000)
    safe_harbor: bool = True
    scope: list[ScopeItem] = Field(default_factory=list, max_length=100)
    rewards: list[RewardTier] = Field(default_factory=list, max_length=5)


class ProgramUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=160)
    description: str | None = Field(default=None, max_length=20_000)
    policy: str | None = Field(default=None, max_length=50_000)
    visibility: ProgramVisibility | None = None
    min_reward_cents: int | None = Field(default=None, ge=0)
    max_reward_cents: int | None = Field(default=None, ge=0)
    response_sla_hours: int | None = Field(default=None, ge=1)
    triage_sla_hours: int | None = Field(default=None, ge=1)
    resolution_sla_days: int | None = Field(default=None, ge=1)
    in_scope_summary: str | None = Field(default=None, max_length=10_000)
    out_of_scope_summary: str | None = Field(default=None, max_length=10_000)
    safe_harbor: bool | None = None


class ProgramRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    slug: str
    name: str
    owner_org_id: UUID
    description: str
    visibility: ProgramVisibility
    status: ProgramStatus
    currency: str
    min_reward_cents: int | None = None
    max_reward_cents: int | None = None
    disclosure_policy: DisclosurePolicy
    safe_harbor: bool
    published_at: datetime | None = None
    total_reports: int
    total_payouts_cents: int
    created_at: datetime


class ProgramDetailRead(ProgramRead):
    policy: str
    response_sla_hours: int
    triage_sla_hours: int
    resolution_sla_days: int
    in_scope_summary: str | None = None
    out_of_scope_summary: str | None = None


class ProgramList(BaseModel):
    items: list[ProgramRead]
    meta: PageMeta


# =============================================================================
# Reports
# =============================================================================


class ReportCreate(BaseModel):
    title: str = Field(min_length=5, max_length=240)
    description_md: str = Field(min_length=50, max_length=50_000)
    reproduction_steps: str = Field(min_length=10, max_length=20_000)
    impact: str = Field(min_length=5, max_length=10_000)
    asset_identifier: str | None = Field(default=None, max_length=500)
    vrt_category: str | None = Field(default=None, max_length=200)
    severity: Severity = "medium"
    cvss_vector: str | None = Field(default=None, max_length=200)
    cvss_score: Decimal | None = Field(default=None, ge=0, le=10)


class ReportRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    short_id: str
    program_id: UUID
    researcher_id: UUID
    title: str
    asset_identifier: str | None = None
    vrt_category: str | None = None
    severity: Severity
    cvss_vector: str | None = None
    cvss_score: Decimal | None = None
    state: ReportState
    triager_id: UUID | None = None
    duplicate_of_id: UUID | None = None
    bounty_cents: int
    bounty_currency: str | None = None
    published: bool
    triaged_at: datetime | None = None
    accepted_at: datetime | None = None
    resolved_at: datetime | None = None
    paid_at: datetime | None = None
    created_at: datetime


class ReportDetailRead(ReportRead):
    description_md: str
    reproduction_steps: str
    impact: str
    rejection_reason: str | None = None


class ReportTriagerRead(ReportDetailRead):
    internal_notes: str | None = None


class ReportList(BaseModel):
    items: list[ReportRead]
    meta: PageMeta


# =============================================================================
# Triage actions
# =============================================================================


class TriageAction(BaseModel):
    severity: Severity
    cvss_vector: str | None = Field(default=None, max_length=200)
    cvss_score: Decimal | None = Field(default=None, ge=0, le=10)
    internal_notes: str | None = Field(default=None, max_length=10_000)


class AcceptAction(TriageAction):
    pass


class RejectAction(BaseModel):
    reason: str = Field(min_length=10, max_length=2000)


class DuplicateAction(BaseModel):
    duplicate_of_id: UUID
    reason: str | None = Field(default=None, max_length=2000)


class ResolveAction(BaseModel):
    notes: str | None = Field(default=None, max_length=5000)


class AwardAction(BaseModel):
    amount_cents: int = Field(gt=0)
    currency: str = Field(default="USD", min_length=3, max_length=3)
    initiate_payout: bool = True


# =============================================================================
# Comments
# =============================================================================


class CommentCreate(BaseModel):
    body_md: str = Field(min_length=1, max_length=20_000)
    visibility: Literal["public", "internal"] = "public"


class CommentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    report_id: UUID
    author_id: UUID
    author_role: str
    visibility: str
    body_md: str
    body_html: str | None = None
    is_state_change: bool
    created_at: datetime
    edited_at: datetime | None = None


# =============================================================================
# Attachments
# =============================================================================


class AttachmentUploadRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    content_type: str = Field(min_length=1, max_length=120)
    byte_size: int = Field(gt=0)


class AttachmentUploadResponse(BaseModel):
    attachment_id: UUID
    s3_key: str
    presigned_url: str
    presigned_fields: dict[str, str] = Field(default_factory=dict)
    expires_at: datetime


class AttachmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    report_id: UUID
    uploader_id: UUID
    filename: str
    content_type: str
    byte_size: int
    sha256: str | None = None
    virus_scanned: bool
    virus_clean: bool | None = None
    created_at: datetime


# =============================================================================
# Payouts
# =============================================================================


class PayoutRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    report_id: UUID
    researcher_id: UUID
    amount_cents: int
    currency: str
    state: PayoutState
    payment_svc_payout_id: str | None = None
    provider_payout_id: str | None = None
    failure_reason: str | None = None
    requested_at: datetime
    paid_at: datetime | None = None


class PayoutList(BaseModel):
    items: list[PayoutRead]
    meta: PageMeta
