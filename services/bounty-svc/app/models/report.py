"""ORM models for reports, comments, attachments, payouts, CVEs."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, BigInteger, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Report(Base):
    __tablename__ = "reports"
    __table_args__ = {"schema": "bounty"}

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    short_id: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    program_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("bounty.programs.id"), nullable=False
    )
    researcher_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)

    title: Mapped[str] = mapped_column(Text, nullable=False)
    description_md: Mapped[str] = mapped_column(Text, nullable=False)
    reproduction_steps: Mapped[str] = mapped_column(Text, nullable=False)
    impact: Mapped[str] = mapped_column(Text, nullable=False)
    asset_identifier: Mapped[str | None] = mapped_column(Text)
    vrt_category: Mapped[str | None] = mapped_column(Text)

    severity: Mapped[str] = mapped_column(String(16), nullable=False, default="medium")
    cvss_vector: Mapped[str | None] = mapped_column(Text)
    cvss_score: Mapped[Decimal | None] = mapped_column(Numeric(3, 1))

    state: Mapped[str] = mapped_column(String(16), nullable=False, default="submitted")
    triager_id: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))
    duplicate_of_id: Mapped[UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("bounty.reports.id")
    )
    rejection_reason: Mapped[str | None] = mapped_column(Text)
    internal_notes: Mapped[str | None] = mapped_column(Text)
    published: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    bounty_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    bounty_currency: Mapped[str | None] = mapped_column(String(8))

    triaged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSONB, nullable=False, default=dict, server_default="{}"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="NOW()"
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="NOW()"
    )


class ReportComment(Base):
    __tablename__ = "report_comments"
    __table_args__ = {"schema": "bounty"}

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    report_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("bounty.reports.id", ondelete="CASCADE"),
        nullable=False,
    )
    author_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    author_role: Mapped[str] = mapped_column(String(16), nullable=False)
    visibility: Mapped[str] = mapped_column(String(16), nullable=False, default="public")
    body_md: Mapped[str] = mapped_column(Text, nullable=False)
    body_html: Mapped[str | None] = mapped_column(Text)
    is_state_change: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="NOW()"
    )
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ReportAttachment(Base):
    __tablename__ = "report_attachments"
    __table_args__ = {"schema": "bounty"}

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    report_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("bounty.reports.id", ondelete="CASCADE"),
        nullable=False,
    )
    uploader_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    filename: Mapped[str] = mapped_column(Text, nullable=False)
    content_type: Mapped[str] = mapped_column(Text, nullable=False)
    byte_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    s3_key: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    sha256: Mapped[str | None] = mapped_column(Text)
    virus_scanned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    virus_clean: Mapped[bool | None] = mapped_column(Boolean)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="NOW()"
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ReportStateTransition(Base):
    __tablename__ = "report_state_transitions"
    __table_args__ = {"schema": "bounty"}

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    report_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("bounty.reports.id", ondelete="CASCADE"),
        nullable=False,
    )
    actor_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    from_state: Mapped[str | None] = mapped_column(String(16))
    to_state: Mapped[str] = mapped_column(String(16), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text)
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSONB, nullable=False, default=dict, server_default="{}"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="NOW()"
    )


class Payout(Base):
    __tablename__ = "payouts"
    __table_args__ = {"schema": "bounty"}

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    report_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("bounty.reports.id"), nullable=False
    )
    researcher_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String(8), nullable=False)
    state: Mapped[str] = mapped_column(String(16), nullable=False, default="requested")
    payment_svc_payout_id: Mapped[str | None] = mapped_column(Text)
    provider_payout_id: Mapped[str | None] = mapped_column(Text)
    failure_reason: Mapped[str | None] = mapped_column(Text)
    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="NOW()"
    )
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSONB, nullable=False, default=dict, server_default="{}"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="NOW()"
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="NOW()"
    )


class CveRecord(Base):
    __tablename__ = "cve_records"
    __table_args__ = {"schema": "bounty"}

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    report_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("bounty.reports.id"), nullable=False
    )
    cve_id: Mapped[str | None] = mapped_column(Text)
    requested_by: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    state: Mapped[str] = mapped_column(String(16), nullable=False, default="requested")
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    advisory_url: Mapped[str | None] = mapped_column(Text)
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSONB, nullable=False, default=dict, server_default="{}"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="NOW()"
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="NOW()"
    )
