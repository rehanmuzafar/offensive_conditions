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
from app.models.event import Event, EventParticipant, EventTeamEntry
from app.services.safepay import SafepayClient

log = get_logger("payments")

# Providers that can be selected via CTF_PAYMENT_PROVIDER.
PROVIDER_MANUAL = "manual"
SUPPORTED_PROVIDERS = {PROVIDER_MANUAL, "jazzcash", "easypaisa", "stripe", "safepay"}

# What a payer can choose at checkout, as opposed to who processes it. Safepay
# presents all three behind one integration, so the provider and the method are
# separate questions and the UI asks only this one.
SUPPORTED_METHODS = {"card", "jazzcash", "easypaisa"}


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

    # =========================================================================
    # Team entries
    #
    # A team's entry fee is paid once, by the captain, and belongs to the team.
    # Everything below works on ctf.event_team_entries rather than on
    # participant rows, which is what lets a captain change the roster after
    # paying without anybody being asked for money a second time.
    # =========================================================================

    async def _load_team(self, event_id: UUID, team_id: UUID) -> tuple[Event, "EventTeamEntry"]:
        event = (
            await self.session.execute(select(Event).where(Event.id == event_id))
        ).scalar_one_or_none()
        if event is None:
            raise AppError(ErrorCode.EVENT_NOT_FOUND, "event not found")

        entry = (
            await self.session.execute(
                select(EventTeamEntry).where(
                    and_(
                        EventTeamEntry.event_id == event_id,
                        EventTeamEntry.team_id == team_id,
                    )
                )
            )
        ).scalar_one_or_none()
        if entry is None:
            raise AppError(ErrorCode.NOT_REGISTERED, "register the team for this event first")
        return event, entry

    async def create_team_intent(
        self,
        event_id: UUID,
        *,
        team_id: UUID,
        captain_id: UUID,
        method: str = "card",
    ) -> dict[str, Any]:
        """Start payment for a team's entry.

        The caller must already have been established as a captain of the team —
        the API layer does that through user-svc, which owns the roster and is
        the only thing that can answer it. This method does not re-derive it,
        but it does record who paid.
        """
        event = (
            await self.session.execute(select(Event).where(Event.id == event_id))
        ).scalar_one_or_none()
        if event is None:
            raise AppError(ErrorCode.EVENT_NOT_FOUND, "event not found")

        if (event.entry_fee_cents or 0) <= 0:
            raise AppError(ErrorCode.VALIDATION, "this event is free")

        # Created here rather than at registration, because for a paid event
        # paying is what brings a team in: players cannot register under a team
        # whose entry is unsettled, so the entry has to exist before anyone —
        # including the captain — has a seat. The captain has already been
        # verified by the API layer against user-svc.
        entry = (
            await self.session.execute(
                select(EventTeamEntry).where(
                    and_(
                        EventTeamEntry.event_id == event_id,
                        EventTeamEntry.team_id == team_id,
                    )
                )
            )
        ).scalar_one_or_none()
        if entry is None:
            entry = EventTeamEntry(event_id=event_id, team_id=team_id)
            self.session.add(entry)
            await self.session.flush()
        if entry.payment_status == "paid":
            raise AppError(ErrorCode.VALIDATION, "this team has already paid")
        if method not in SUPPORTED_METHODS:
            raise AppError(
                ErrorCode.VALIDATION,
                f"unsupported payment method '{method}'",
            )

        # Keyed on the team, not on a person or an attempt, so a captain who
        # abandons a half-finished payment and starts again lands on the same
        # entry instead of creating a second one.
        reference = f"OFFCON-{str(event.id)[:8]}-{str(team_id)[:8]}".upper()

        entry.payment_status = "pending"
        entry.paid_by_user_id = captain_id
        entry.provider = self.provider
        entry.provider_reference = reference
        entry.amount_cents = event.entry_fee_cents
        entry.currency = event.currency
        entry.updated_at = datetime.now(timezone.utc)
        await self.session.flush()

        payload: dict[str, Any] = {
            "provider": self.provider,
            "method": method,
            "reference": reference,
            "amount_cents": event.entry_fee_cents,
            "currency": event.currency,
            "status": "pending",
            "methods_available": sorted(SUPPORTED_METHODS),
        }

        if self.provider == PROVIDER_MANUAL:
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
        elif self.provider == "safepay":
            client = SafepayClient(self._s)
            if not client.configured:
                # No keys means no session to send anyone to. Saying so beats a
                # plausible-looking URL that leads nowhere.
                payload["instructions"] = {
                    "method": "redirect",
                    "redirect_url": None,
                    "note": "safepay keys are not configured yet",
                }
            else:
                tracker = await client.create_tracker(
                    amount_minor=event.entry_fee_cents,
                    currency=event.currency,
                    reference=reference,
                )
                # Stored now rather than on the webhook: if the payer completes
                # the payment and the webhook is delayed or lost, this is what
                # lets the entry be matched to the transaction by hand.
                entry.provider_reference = tracker
                await self.session.flush()

                payload["reference"] = tracker
                payload["instructions"] = {
                    "method": "redirect",
                    "redirect_url": client.checkout_url(tracker),
                    "note": "",
                }
        else:
            payload["instructions"] = {
                "method": "redirect",
                "redirect_url": None,
                "note": f"{self.provider} credentials are not configured yet",
            }

        log.info(
            "team_payment_intent_created",
            event_id=str(event_id),
            team_id=str(team_id),
            captain_id=str(captain_id),
            provider=self.provider,
            method=method,
            reference=reference,
            amount_cents=event.entry_fee_cents,
        )
        return payload

    async def confirm_team(
        self,
        event_id: UUID,
        *,
        team_id: UUID,
        provider_reference: str | None = None,
        amount_cents: int | None = None,
    ) -> "EventTeamEntry":
        """Settle a team's entry. Idempotent.

        Idempotence is not a nicety here: every gateway retries its webhook, and
        this increments the event's participant count. Confirming twice would
        inflate it permanently.
        """
        event, entry = await self._load_team(event_id, team_id)

        if entry.payment_status == "paid":
            return entry

        entry.payment_status = "paid"
        entry.amount_cents = amount_cents or event.entry_fee_cents
        entry.currency = event.currency
        entry.provider = entry.provider or self.provider
        if provider_reference:
            entry.provider_reference = provider_reference
        entry.paid_at = datetime.now(timezone.utc)
        entry.updated_at = entry.paid_at

        # Registration holds the seat without counting it; this is where it
        # becomes real. Mirrors the solo path in PaymentService.confirm.
        await self.session.execute(
            Event.__table__.update()
            .where(Event.id == event_id)
            .values(total_registered=Event.total_registered + 1)
        )
        await self.session.flush()

        log.info(
            "team_payment_confirmed",
            event_id=str(event_id),
            team_id=str(team_id),
            provider=entry.provider,
            reference=entry.provider_reference,
            amount_cents=entry.amount_cents,
        )
        return entry

    async def team_entry(self, event_id: UUID, team_id: UUID) -> "EventTeamEntry":
        """A team's entry, for callers that only want to read its state."""
        _, entry = await self._load_team(event_id, team_id)
        return entry

    async def list_pending_teams(self, event_id: UUID) -> list["EventTeamEntry"]:
        """Teams waiting on a payment — what an organiser confirming bank
        transfers needs to see."""
        result = await self.session.execute(
            select(EventTeamEntry)
            .where(
                and_(
                    EventTeamEntry.event_id == event_id,
                    EventTeamEntry.payment_status == "pending",
                )
            )
            .order_by(EventTeamEntry.created_at)
        )
        return list(result.scalars().all())
