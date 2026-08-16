"""Payout service: orchestrates bounty payouts via payment-svc."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy import and_, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import AppError, ErrorCode
from app.core.logging import get_logger
from app.models import Payout, Program, Report
from app.services.payment_client import PaymentClient

log = get_logger("payouts")


class PayoutService:
    def __init__(
        self,
        session: AsyncSession,
        settings: Settings,
        payment_client: PaymentClient,
    ) -> None:
        self.session = session
        self._settings = settings
        self._payment = payment_client

    async def get(self, payout_id: UUID) -> Payout:
        result = await self.session.execute(select(Payout).where(Payout.id == payout_id))
        payout = result.scalar_one_or_none()
        if not payout:
            raise AppError(ErrorCode.PAYOUT_NOT_FOUND, "payout not found")
        return payout

    async def list_for_researcher(
        self, researcher_id: UUID, *, limit: int = 25, offset: int = 0
    ) -> tuple[list[Payout], int]:
        stmt = (
            select(Payout)
            .where(Payout.researcher_id == researcher_id)
            .order_by(Payout.created_at.desc())
        )
        count_stmt = (
            select(func.count())
            .select_from(Payout)
            .where(Payout.researcher_id == researcher_id)
        )
        total = (await self.session.execute(count_stmt)).scalar_one()
        result = await self.session.execute(stmt.limit(limit).offset(offset))
        return list(result.scalars().all()), int(total)

    async def get_active_for_report(self, report_id: UUID) -> Payout | None:
        result = await self.session.execute(
            select(Payout).where(
                Payout.report_id == report_id,
                Payout.state.in_(("requested", "processing", "paid")),
            )
        )
        return result.scalar_one_or_none()

    async def request_payout(
        self,
        *,
        report: Report,
        actor_id: UUID,
    ) -> Payout:
        """Initiate a payout for an awarded bounty.

        Pre-conditions:
          - report.bounty_cents > 0
          - report.state in {accepted, resolved}
          - no existing active payout for this report
        Calls payment-svc to actually trigger the Stripe Connect transfer.
        """
        if report.bounty_cents <= 0 or not report.bounty_currency:
            raise AppError(
                ErrorCode.BAD_REQUEST,
                "report has no bounty amount set — award first",
            )
        if report.state not in ("accepted", "resolved"):
            raise AppError(
                ErrorCode.REPORT_INVALID_STATE,
                "report must be accepted/resolved before payout",
            )

        # Cap check against program-level reward tiers (defensive)
        program_result = await self.session.execute(
            select(Program).where(Program.id == report.program_id)
        )
        program = program_result.scalar_one()
        cap_cents = _severity_cap(self._settings, report.severity)
        if report.bounty_cents > cap_cents:
            raise AppError(
                ErrorCode.PAYOUT_AMOUNT_EXCEEDS_CAP,
                f"bounty {report.bounty_cents} exceeds the default cap "
                f"of {cap_cents} cents for severity {report.severity}",
                details={"cap_cents": cap_cents},
            )

        # Existing active payout?
        active = await self.get_active_for_report(report.id)
        if active:
            raise AppError(
                ErrorCode.PAYOUT_ALREADY_REQUESTED,
                "a payout is already in progress for this report",
                details={"payout_id": str(active.id), "state": active.state},
            )

        # Verify researcher has a Stripe Connect account
        account = await self._payment.check_payout_account(
            user_id=str(report.researcher_id)
        )
        if not account.get("can_receive_payouts"):
            if not account.get("verified", False):
                raise AppError(
                    ErrorCode.PAYOUT_ACCOUNT_UNVERIFIED,
                    "researcher's payout account is not verified",
                )
            raise AppError(
                ErrorCode.PAYOUT_ACCOUNT_MISSING,
                "researcher has not registered a Stripe Connect account",
            )

        # Create local payout row first (state=requested)
        idempotency_key = f"bounty:{report.id}:{uuid4().hex[:12]}"
        payout = Payout(
            report_id=report.id,
            researcher_id=report.researcher_id,
            amount_cents=report.bounty_cents,
            currency=report.bounty_currency or program.currency,
            state="requested",
            metadata_={"idempotency_key": idempotency_key, "requested_by": str(actor_id)},
        )
        self.session.add(payout)
        try:
            await self.session.flush()
        except IntegrityError:
            await self.session.rollback()
            raise AppError(
                ErrorCode.PAYOUT_ALREADY_REQUESTED,
                "another payout was created concurrently",
            )

        # Call payment-svc
        try:
            response = await self._payment.request_bounty_payout(
                researcher_id=str(report.researcher_id),
                amount_cents=report.bounty_cents,
                currency=payout.currency,
                report_id=str(report.id),
                idempotency_key=idempotency_key,
            )
        except AppError:
            # Mark payout failed locally and re-raise
            payout.state = "failed"
            payout.failure_reason = "payment-svc call failed"
            payout.updated_at = datetime.now(timezone.utc)
            await self.session.flush()
            raise

        payout.payment_svc_payout_id = response.get("payout_id") or response.get("id")
        payout.provider_payout_id = response.get("provider_payout_id")
        new_state = response.get("state", "processing")
        if new_state in ("requested", "processing", "paid", "failed"):
            payout.state = new_state
        else:
            payout.state = "processing"
        if payout.state == "paid":
            payout.paid_at = datetime.now(timezone.utc)
        payout.updated_at = datetime.now(timezone.utc)
        await self.session.flush()

        # Bump program total payouts
        if payout.state in ("processing", "paid"):
            await self.session.execute(
                Program.__table__.update()
                .where(Program.id == program.id)
                .values(
                    total_payouts_cents=Program.total_payouts_cents + payout.amount_cents,
                    updated_at=datetime.now(timezone.utc),
                )
            )

        log.info(
            "payout_requested",
            payout_id=str(payout.id),
            report_id=str(report.id),
            amount_cents=payout.amount_cents,
            state=payout.state,
            actor=str(actor_id),
        )
        return payout

    async def mark_paid(
        self, *, payment_svc_payout_id: str, provider_payout_id: str | None = None
    ) -> Payout | None:
        """Called by Kafka consumer when payment-svc emits `payout.sent`."""
        result = await self.session.execute(
            select(Payout).where(Payout.payment_svc_payout_id == payment_svc_payout_id)
        )
        payout = result.scalar_one_or_none()
        if not payout:
            return None
        if payout.state == "paid":
            return payout  # idempotent
        payout.state = "paid"
        payout.paid_at = datetime.now(timezone.utc)
        if provider_payout_id:
            payout.provider_payout_id = provider_payout_id
        payout.updated_at = datetime.now(timezone.utc)
        await self.session.flush()
        log.info(
            "payout_marked_paid",
            payout_id=str(payout.id),
            payment_svc_payout_id=payment_svc_payout_id,
        )
        return payout

    async def mark_failed(
        self, *, payment_svc_payout_id: str, reason: str
    ) -> Payout | None:
        result = await self.session.execute(
            select(Payout).where(Payout.payment_svc_payout_id == payment_svc_payout_id)
        )
        payout = result.scalar_one_or_none()
        if not payout:
            return None
        payout.state = "failed"
        payout.failure_reason = reason[:1000]
        payout.updated_at = datetime.now(timezone.utc)
        await self.session.flush()
        return payout


def _severity_cap(settings: Settings, severity: str) -> int:
    return {
        "critical": settings.severity_default_cap_cents_critical,
        "high": settings.severity_default_cap_cents_high,
        "medium": settings.severity_default_cap_cents_medium,
        "low": settings.severity_default_cap_cents_low,
        "informational": 0,
    }.get(severity, 0)
