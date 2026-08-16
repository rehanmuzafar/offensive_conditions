"""Entry-fee payments for paid CTF events.

Deliberately provider-agnostic. A payment moves through the same two steps no
matter who processes the money:

    intent  -> the participant is told how to pay (bank details, or a redirect
               URL once a gateway is wired in)
    confirm -> the payment is recorded, the seat becomes 'paid' and the event's
               participant count is incremented

`confirm` is the single place that grants a seat, so a gateway webhook and an
admin approving a bank transfer both go through identical logic. Adding a real
gateway means implementing `create_intent` for it — nothing else changes.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import AppError, ErrorCode
from app.core.logging import get_logger
from app.models.event import Event, EventParticipant

log = get_logger("payments")

# Providers that can be selected via CTF_PAYMENT_PROVIDER.
PROVIDER_MANUAL = "manual"
SUPPORTED_PROVIDERS = {PROVIDER_MANUAL, "jazzcash", "easypaisa", "stripe"}


class PaymentService:
    def __init__(self, session: AsyncSession, settings: Settings) -> None:
        self.session = session
        self._s = settings

    @property
    def provider(self) -> str:
        raw = (getattr(self._s, "ctf_payment_provider", "") or PROVIDER_MANUAL).lower()
        return raw if raw in SUPPORTED_PROVIDERS else PROVIDER_MANUAL

    async def _load(self, event_id: UUID, user_id: UUID) -> tuple[Event, EventParticipant]:
        event = (
            await self.session.execute(select(Event).where(Event.id == event_id))
        ).scalar_one_or_none()
        if event is None:
            raise AppError(ErrorCode.EVENT_NOT_FOUND, "event not found")

        participant = (
            await self.session.execute(
                select(EventParticipant).where(
                    and_(
                        EventParticipant.event_id == event_id,
                        EventParticipant.user_id == user_id,
                    )
                )
            )
        ).scalar_one_or_none()
        if participant is None:
            raise AppError(ErrorCode.NOT_REGISTERED, "register for the event first")
        return event, participant

    # ------------------------------------------------------------------ intent
    async def create_intent(self, event_id: UUID, *, user_id: UUID) -> dict[str, Any]:
        event, participant = await self._load(event_id, user_id)

        if (event.entry_fee_cents or 0) <= 0:
            raise AppError(ErrorCode.VALIDATION, "this event is free")
        if participant.payment_status == "paid":
            raise AppError(ErrorCode.VALIDATION, "already paid")

        # Stable per-participant reference so a retry does not create a second
        # payment, and so a bank transfer can be matched back to the seat.
        reference = f"OFFCON-{str(event.id)[:8]}-{str(participant.id)[:8]}".upper()

        participant.payment_status = "pending"
        participant.payment_provider = self.provider
        participant.payment_reference = reference
        participant.payment_currency = event.currency
        await self.session.flush()

        payload: dict[str, Any] = {
            "provider": self.provider,
            "reference": reference,
            "amount_cents": event.entry_fee_cents,
            "currency": event.currency,
            "status": "pending",
        }

        if self.provider == PROVIDER_MANUAL:
            # No gateway configured yet: hand back bank details and let an admin
            # confirm once the transfer lands.
            payload["instructions"] = {
                "method": "bank_transfer",
                "account_name": getattr(self._s, "payout_account_name", "") or "",
                "account_number": getattr(self._s, "payout_account_number", "") or "",
                "bank_name": getattr(self._s, "payout_bank_name", "") or "",
                "iban": getattr(self._s, "payout_iban", "") or "",
                "note": (
                    "Transfer the exact amount and put the reference in the "
                    "payment description, then wait for an organiser to confirm."
                ),
            }
        else:
            # A gateway adapter fills this in; until then be explicit rather
            # than silently pretending the payment can proceed.
            payload["instructions"] = {
                "method": "redirect",
                "redirect_url": None,
                "note": f"{self.provider} credentials are not configured yet",
            }

        log.info(
            "payment_intent_created",
            event_id=str(event_id),
            user_id=str(user_id),
            provider=self.provider,
            reference=reference,
            amount_cents=event.entry_fee_cents,
        )
        return payload

    # ----------------------------------------------------------------- confirm
    async def confirm(
        self,
        event_id: UUID,
        *,
        participant_id: UUID,
        provider_reference: str | None = None,
        amount_cents: int | None = None,
    ) -> EventParticipant:
        """Mark a seat paid. Idempotent — confirming twice is a no-op."""
        event = (
            await self.session.execute(select(Event).where(Event.id == event_id))
        ).scalar_one_or_none()
        if event is None:
            raise AppError(ErrorCode.EVENT_NOT_FOUND, "event not found")

        participant = (
            await self.session.execute(
                select(EventParticipant).where(
                    and_(
                        EventParticipant.id == participant_id,
                        EventParticipant.event_id == event_id,
                    )
                )
            )
        ).scalar_one_or_none()
        if participant is None:
            raise AppError(ErrorCode.NOT_REGISTERED, "participant not found")

        if participant.payment_status == "paid":
            return participant  # idempotent

        participant.payment_status = "paid"
        participant.amount_paid_cents = amount_cents or event.entry_fee_cents
        participant.payment_currency = event.currency
        participant.payment_provider = participant.payment_provider or self.provider
        if provider_reference:
            participant.payment_reference = provider_reference
        participant.paid_at = datetime.now(timezone.utc)

        # The seat only counts once it is paid — registration deliberately does
        # not increment this for paid events.
        await self.session.execute(
            Event.__table__.update()
            .where(Event.id == event_id)
            .values(total_registered=Event.total_registered + 1)
        )
        await self.session.flush()

        log.info(
            "payment_confirmed",
            event_id=str(event_id),
            participant_id=str(participant_id),
            provider=participant.payment_provider,
            amount_cents=participant.amount_paid_cents,
        )
        return participant

    # -------------------------------------------------------------- admin list
    async def list_pending(self, event_id: UUID) -> list[EventParticipant]:
        rows = await self.session.execute(
            select(EventParticipant)
            .where(
                and_(
                    EventParticipant.event_id == event_id,
                    EventParticipant.payment_status == "pending",
                )
            )
            .order_by(EventParticipant.registered_at)
        )
        return list(rows.scalars().all())
