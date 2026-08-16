"""ORM models for bounty programs + scope + rewards."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, BigInteger, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Program(Base):
    __tablename__ = "programs"
    __table_args__ = {"schema": "bounty"}

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    slug: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    owner_org_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    owner_user_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    policy: Mapped[str] = mapped_column(Text, nullable=False)
    visibility: Mapped[str] = mapped_column(String(16), nullable=False, default="public")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft")
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="USD")
    min_reward_cents: Mapped[int | None] = mapped_column(Integer)
    max_reward_cents: Mapped[int | None] = mapped_column(Integer)
    disclosure_policy: Mapped[str] = mapped_column(String(16), nullable=False, default="coordinated")
    response_sla_hours: Mapped[int] = mapped_column(Integer, nullable=False, default=72)
    triage_sla_hours: Mapped[int] = mapped_column(Integer, nullable=False, default=168)
    resolution_sla_days: Mapped[int] = mapped_column(Integer, nullable=False, default=90)
    in_scope_summary: Mapped[str | None] = mapped_column(Text)
    out_of_scope_summary: Mapped[str | None] = mapped_column(Text)
    safe_harbor: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    paused_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    total_reports: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_payouts_cents: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSONB, nullable=False, default=dict, server_default="{}"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="NOW()"
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="NOW()"
    )


class ProgramScope(Base):
    __tablename__ = "program_scope"
    __table_args__ = {"schema": "bounty"}

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    program_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("bounty.programs.id", ondelete="CASCADE"),
        nullable=False,
    )
    asset_type: Mapped[str] = mapped_column(String(16), nullable=False)
    asset_identifier: Mapped[str] = mapped_column(Text, nullable=False)
    severity_max: Mapped[str] = mapped_column(String(16), nullable=False, default="critical")
    in_scope: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="NOW()"
    )


class ProgramReward(Base):
    __tablename__ = "program_rewards"
    __table_args__ = {"schema": "bounty"}

    program_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("bounty.programs.id", ondelete="CASCADE"),
        primary_key=True,
    )
    severity: Mapped[str] = mapped_column(String(16), primary_key=True)
    min_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    max_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="USD")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="NOW()"
    )
