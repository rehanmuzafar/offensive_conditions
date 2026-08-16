"""Report service: submission, state machine, triage actions, awards."""

from __future__ import annotations

import secrets
import string
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, ErrorCode
from app.core.logging import get_logger
from app.models import (
    Program,
    Report,
    ReportStateTransition,
)
from app.schemas import (
    AcceptAction,
    AwardAction,
    DuplicateAction,
    RejectAction,
    ReportCreate,
    ResolveAction,
)
from app.services.programs import ProgramService
from app.utils.markdown import render_safe_html  # noqa: F401  (used by comments svc)

log = get_logger("reports")


# Reports state machine:
#   submitted → triaging → accepted → resolved → paid → closed
#                       ↘ rejected | duplicate | informational
_ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "submitted": {"triaging", "duplicate"},
    "triaging": {"accepted", "rejected", "duplicate", "informational"},
    "accepted": {"resolved", "rejected"},  # rare: re-reject post-accept
    "rejected": {"submitted"},  # reopened by appeal
    "duplicate": set(),
    "informational": set(),
    "resolved": {"paid", "closed"},
    "paid": {"closed"},
    "closed": set(),
}


def _generate_short_id() -> str:
    """Generate a human-friendly short ID like REPORT-A4F2X9."""
    alphabet = string.ascii_uppercase + string.digits
    return "REPORT-" + "".join(secrets.choice(alphabet) for _ in range(6))


class ReportService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self._programs = ProgramService(session)

    # =========================================================================
    # Reads
    # =========================================================================

    async def get(self, report_id: UUID) -> Report:
        result = await self.session.execute(
            select(Report).where(Report.id == report_id)
        )
        report = result.scalar_one_or_none()
        if not report:
            raise AppError(ErrorCode.REPORT_NOT_FOUND, "report not found")
        return report

    async def get_by_short_id(self, short_id: str) -> Report:
        result = await self.session.execute(
            select(Report).where(Report.short_id == short_id.upper())
        )
        report = result.scalar_one_or_none()
        if not report:
            raise AppError(ErrorCode.REPORT_NOT_FOUND, "report not found")
        return report

    async def list_for_researcher(
        self,
        researcher_id: UUID,
        *,
        state: str | None = None,
        limit: int = 25,
        offset: int = 0,
    ) -> tuple[list[Report], int]:
        stmt = select(Report).where(Report.researcher_id == researcher_id)
        count_stmt = (
            select(func.count())
            .select_from(Report)
            .where(Report.researcher_id == researcher_id)
        )
        if state:
            stmt = stmt.where(Report.state == state)
            count_stmt = count_stmt.where(Report.state == state)
        stmt = stmt.order_by(Report.created_at.desc())
        total = (await self.session.execute(count_stmt)).scalar_one()
        result = await self.session.execute(stmt.limit(limit).offset(offset))
        return list(result.scalars().all()), int(total)

    async def list_for_program(
        self,
        program_id: UUID,
        *,
        state: str | None = None,
        severity: str | None = None,
        limit: int = 25,
        offset: int = 0,
    ) -> tuple[list[Report], int]:
        stmt = select(Report).where(Report.program_id == program_id)
        count_stmt = (
            select(func.count())
            .select_from(Report)
            .where(Report.program_id == program_id)
        )
        if state:
            stmt = stmt.where(Report.state == state)
            count_stmt = count_stmt.where(Report.state == state)
        if severity:
            stmt = stmt.where(Report.severity == severity)
            count_stmt = count_stmt.where(Report.severity == severity)
        stmt = stmt.order_by(Report.created_at.desc())
        total = (await self.session.execute(count_stmt)).scalar_one()
        result = await self.session.execute(stmt.limit(limit).offset(offset))
        return list(result.scalars().all()), int(total)

    # =========================================================================
    # Submit
    # =========================================================================

    async def submit(
        self,
        *,
        program: Program,
        researcher_id: UUID,
        data: ReportCreate,
    ) -> Report:
        if program.status != "published":
            if program.status == "paused":
                raise AppError(
                    ErrorCode.PROGRAM_PAUSED, "program is not accepting new submissions"
                )
            if program.status == "closed":
                raise AppError(ErrorCode.PROGRAM_CLOSED, "program is closed")
            raise AppError(
                ErrorCode.PROGRAM_NOT_PUBLISHED, "program is not published yet"
            )

        # Scope check
        in_scope = await self._programs.is_asset_in_scope(
            program.id, asset_identifier=data.asset_identifier
        )
        if not in_scope:
            raise AppError(
                ErrorCode.OUT_OF_SCOPE,
                "the specified asset is not in scope for this program",
                details={"asset_identifier": data.asset_identifier},
            )

        # Generate a unique short_id with retry on collision
        short_id = _generate_short_id()
        for _ in range(5):
            existing = await self.session.execute(
                select(Report.id).where(Report.short_id == short_id)
            )
            if existing.scalar_one_or_none() is None:
                break
            short_id = _generate_short_id()

        report = Report(
            short_id=short_id,
            program_id=program.id,
            researcher_id=researcher_id,
            title=data.title,
            description_md=data.description_md,
            reproduction_steps=data.reproduction_steps,
            impact=data.impact,
            asset_identifier=data.asset_identifier,
            vrt_category=data.vrt_category,
            severity=data.severity,
            cvss_vector=data.cvss_vector,
            cvss_score=data.cvss_score,
            state="submitted",
        )
        self.session.add(report)
        await self.session.flush()

        # Audit log: initial state
        self.session.add(
            ReportStateTransition(
                report_id=report.id,
                actor_id=researcher_id,
                from_state=None,
                to_state="submitted",
                reason="initial submission",
            )
        )

        # Bump program counter
        await self.session.execute(
            Program.__table__.update()
            .where(Program.id == program.id)
            .values(total_reports=Program.total_reports + 1, updated_at=datetime.now(timezone.utc))
        )
        await self.session.flush()

        log.info(
            "report_submitted",
            report_id=str(report.id),
            short_id=report.short_id,
            program_id=str(program.id),
            researcher=str(researcher_id),
            severity=report.severity,
        )
        return report

    # =========================================================================
    # State transitions (mod-only)
    # =========================================================================

    async def _transition(
        self,
        report: Report,
        *,
        new_state: str,
        actor_id: UUID,
        reason: str | None = None,
        metadata: dict | None = None,
    ) -> Report:
        allowed = _ALLOWED_TRANSITIONS.get(report.state, set())
        if new_state not in allowed:
            raise AppError(
                ErrorCode.REPORT_INVALID_STATE,
                f"cannot transition report from {report.state} to {new_state}",
            )
        prev = report.state
        report.state = new_state
        now = datetime.now(timezone.utc)
        if new_state == "triaging":
            report.triaged_at = report.triaged_at or now
            report.triager_id = actor_id
        elif new_state == "accepted":
            report.accepted_at = now
        elif new_state == "resolved":
            report.resolved_at = now
        elif new_state == "paid":
            report.paid_at = now
        report.updated_at = now

        self.session.add(
            ReportStateTransition(
                report_id=report.id,
                actor_id=actor_id,
                from_state=prev,
                to_state=new_state,
                reason=reason,
                metadata_=metadata or {},
            )
        )
        await self.session.flush()
        log.info(
            "report_state_changed",
            report_id=str(report.id),
            from_state=prev,
            to_state=new_state,
            actor=str(actor_id),
        )
        return report

    async def start_triage(self, report_id: UUID, *, triager_id: UUID) -> Report:
        report = await self.get(report_id)
        return await self._transition(
            report, new_state="triaging", actor_id=triager_id, reason="triage opened"
        )

    async def accept(
        self, report_id: UUID, *, triager_id: UUID, action: AcceptAction
    ) -> Report:
        report = await self.get(report_id)
        if report.state == "submitted":
            await self._transition(
                report, new_state="triaging", actor_id=triager_id, reason="auto-triage on accept"
            )
        report.severity = action.severity
        report.cvss_vector = action.cvss_vector or report.cvss_vector
        report.cvss_score = action.cvss_score if action.cvss_score is not None else report.cvss_score
        if action.internal_notes is not None:
            report.internal_notes = action.internal_notes
        return await self._transition(
            report, new_state="accepted", actor_id=triager_id, reason="report accepted"
        )

    async def reject(
        self, report_id: UUID, *, triager_id: UUID, action: RejectAction
    ) -> Report:
        report = await self.get(report_id)
        if report.state == "submitted":
            await self._transition(
                report, new_state="triaging", actor_id=triager_id, reason="auto-triage on reject"
            )
        report.rejection_reason = action.reason
        return await self._transition(
            report,
            new_state="rejected",
            actor_id=triager_id,
            reason=action.reason[:200],
        )

    async def mark_duplicate(
        self, report_id: UUID, *, triager_id: UUID, action: DuplicateAction
    ) -> Report:
        report = await self.get(report_id)
        if action.duplicate_of_id == report_id:
            raise AppError(
                ErrorCode.DUPLICATE_OF_SELF, "a report cannot be a duplicate of itself"
            )
        # Verify the target exists
        original = await self.get(action.duplicate_of_id)
        if original.program_id != report.program_id:
            raise AppError(
                ErrorCode.BAD_REQUEST,
                "duplicate target must belong to the same program",
            )
        report.duplicate_of_id = action.duplicate_of_id
        return await self._transition(
            report,
            new_state="duplicate",
            actor_id=triager_id,
            reason=action.reason,
            metadata={"duplicate_of_id": str(action.duplicate_of_id)},
        )

    async def mark_informational(
        self, report_id: UUID, *, triager_id: UUID, reason: str | None = None
    ) -> Report:
        report = await self.get(report_id)
        return await self._transition(
            report,
            new_state="informational",
            actor_id=triager_id,
            reason=reason or "informational only — no bounty",
        )

    async def resolve(
        self, report_id: UUID, *, triager_id: UUID, action: ResolveAction
    ) -> Report:
        report = await self.get(report_id)
        return await self._transition(
            report,
            new_state="resolved",
            actor_id=triager_id,
            reason=action.notes,
        )

    async def close(self, report_id: UUID, *, actor_id: UUID) -> Report:
        report = await self.get(report_id)
        return await self._transition(
            report, new_state="closed", actor_id=actor_id, reason="closed"
        )

    # =========================================================================
    # Award bounty (sets the amount; payout creation is in PayoutService)
    # =========================================================================

    async def set_bounty_amount(
        self, report_id: UUID, *, action: AwardAction, actor_id: UUID
    ) -> Report:
        report = await self.get(report_id)
        if report.state not in ("accepted", "resolved", "paid"):
            raise AppError(
                ErrorCode.REPORT_INVALID_STATE,
                "bounty can only be awarded on accepted/resolved reports",
            )
        report.bounty_cents = action.amount_cents
        report.bounty_currency = action.currency
        report.updated_at = datetime.now(timezone.utc)
        self.session.add(
            ReportStateTransition(
                report_id=report.id,
                actor_id=actor_id,
                from_state=report.state,
                to_state=report.state,  # no state change, just an audit row
                reason=f"bounty set to {action.amount_cents} {action.currency}",
                metadata_={
                    "amount_cents": action.amount_cents,
                    "currency": action.currency,
                },
            )
        )
        await self.session.flush()
        log.info(
            "report_bounty_set",
            report_id=str(report_id),
            amount_cents=action.amount_cents,
            currency=action.currency,
            actor=str(actor_id),
        )
        return report

    # =========================================================================
    # Mark paid (called by payout service after Stripe success)
    # =========================================================================

    async def mark_paid(self, report_id: UUID, *, actor_id: UUID) -> Report:
        report = await self.get(report_id)
        if report.state == "paid":
            return report  # idempotent
        if report.state not in ("resolved", "accepted"):
            raise AppError(
                ErrorCode.REPORT_INVALID_STATE,
                "report must be resolved/accepted before marking paid",
            )
        return await self._transition(
            report, new_state="paid", actor_id=actor_id, reason="payout completed"
        )
