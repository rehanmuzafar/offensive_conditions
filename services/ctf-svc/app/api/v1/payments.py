"""Entry-fee payment endpoints for paid CTF events."""

from __future__ import annotations

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_claims, get_request_id
from app.core.auth import Claims
from app.core.config import get_settings
from app.core.errors import AppError, ErrorCode
from app.db.session import get_session
from app.services.payments import PaymentService
from app.services.user_client import UserServiceClient

router = APIRouter(prefix="/events/{event_id}/payment", tags=["payments"])


async def get_payment_service(session: AsyncSession = Depends(get_session)) -> PaymentService:
    return PaymentService(session, get_settings())


class PaymentIntentResponse(BaseModel):
    provider: str
    reference: str
    amount_cents: int
    currency: str
    status: str
    instructions: dict[str, Any]


class ConfirmPaymentRequest(BaseModel):
    participant_id: UUID
    provider_reference: str | None = Field(default=None, max_length=200)
    amount_cents: int | None = Field(default=None, ge=0)


class PendingPayment(BaseModel):
    participant_id: UUID
    user_id: UUID | None
    payment_status: str
    payment_reference: str | None
    payment_provider: str | None
    registered_at: str


@router.post("/intent", response_model=PaymentIntentResponse)
async def create_payment_intent(
    event_id: UUID,
    claims: Claims = Depends(get_claims),
    svc: PaymentService = Depends(get_payment_service),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> PaymentIntentResponse:
    """Start paying the entry fee for an event you have registered for."""
    data = await svc.create_intent(event_id, user_id=claims.user_id)
    return PaymentIntentResponse(**data)


@router.post("/confirm")
async def confirm_payment(
    event_id: UUID,
    body: ConfirmPaymentRequest,
    claims: Claims = Depends(get_claims),
    svc: PaymentService = Depends(get_payment_service),
) -> dict[str, Any]:
    """Record a settled payment and grant the seat.

    Organiser-only. A gateway webhook will call the same service method, so the
    seat-granting logic has exactly one implementation.
    """
    if not claims.is_ctf_organizer:
        raise AppError(ErrorCode.NOT_ORGANIZER, "ctf_organizer role required")
    p = await svc.confirm(
        event_id,
        participant_id=body.participant_id,
        provider_reference=body.provider_reference,
        amount_cents=body.amount_cents,
    )
    return {
        "participant_id": str(p.id),
        "payment_status": p.payment_status,
        "amount_paid_cents": p.amount_paid_cents,
        "currency": p.payment_currency,
    }


@router.get("/pending", response_model=list[PendingPayment])
async def list_pending_payments(
    event_id: UUID,
    claims: Claims = Depends(get_claims),
    svc: PaymentService = Depends(get_payment_service),
) -> list[PendingPayment]:
    """Seats awaiting payment — the organiser's confirmation queue."""
    if not claims.is_ctf_organizer:
        raise AppError(ErrorCode.NOT_ORGANIZER, "ctf_organizer role required")
    return [
        PendingPayment(
            participant_id=p.id,
            user_id=p.user_id,
            payment_status=p.payment_status,
            payment_reference=p.payment_reference,
            payment_provider=p.payment_provider,
            registered_at=p.registered_at.isoformat(),
        )
        for p in await svc.list_pending(event_id)
    ]


# =============================================================================
# Team entries
#
# A team pays once. These endpoints work on the team's entry rather than on a
# participant row, which is what keeps the payment attached to the team while
# its roster changes underneath.
# =============================================================================


class TeamIntentRequest(BaseModel):
    team_id: UUID
    # What the payer wants to use. The provider is a separate matter and comes
    # from configuration — Safepay, for instance, offers all three itself.
    method: str = Field(default="card", pattern="^(card|jazzcash|easypaisa)$")


class TeamIntentResponse(BaseModel):
    provider: str
    method: str
    reference: str
    amount_cents: int
    currency: str
    status: str
    methods_available: list[str]
    instructions: dict[str, Any]


class ConfirmTeamRequest(BaseModel):
    team_id: UUID
    provider_reference: str | None = Field(default=None, max_length=200)
    amount_cents: int | None = Field(default=None, ge=0)


class PendingTeamPayment(BaseModel):
    team_id: UUID
    paid_by_user_id: UUID | None
    payment_status: str
    provider_reference: str | None
    provider: str | None
    amount_cents: int
    currency: str | None


@router.post("/team/intent", response_model=TeamIntentResponse)
async def create_team_payment_intent(
    event_id: UUID,
    body: TeamIntentRequest,
    claims: Claims = Depends(get_claims),
    svc: PaymentService = Depends(get_payment_service),
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
) -> TeamIntentResponse:
    """Start paying a team's entry fee. Captains only.

    Captaincy is checked against user-svc rather than assumed from anything in
    this service: the roster lives there, it changes without us, and a stale
    idea of who leads a team is the one mistake that would let the wrong person
    spend the team's money.
    """
    await UserServiceClient(get_settings()).get_team_for_registration(
        body.team_id, bearer=authorization or "", actor_id=claims.user_id
    )
    data = await svc.create_team_intent(
        event_id,
        team_id=body.team_id,
        captain_id=claims.user_id,
        method=body.method,
    )
    return TeamIntentResponse(**data)


@router.post("/team/confirm")
async def confirm_team_payment(
    event_id: UUID,
    body: ConfirmTeamRequest,
    claims: Claims = Depends(get_claims),
    svc: PaymentService = Depends(get_payment_service),
) -> dict[str, Any]:
    """Settle a team's entry. Organiser-only, and idempotent.

    A gateway webhook will call the same service method, so there is one
    implementation of "this team is in" no matter how the money arrived.
    """
    if not claims.is_ctf_organizer:
        raise AppError(ErrorCode.NOT_ORGANIZER, "ctf_organizer role required")
    entry = await svc.confirm_team(
        event_id,
        team_id=body.team_id,
        provider_reference=body.provider_reference,
        amount_cents=body.amount_cents,
    )
    return {
        "team_id": str(entry.team_id),
        "payment_status": entry.payment_status,
        "amount_cents": entry.amount_cents,
        "currency": entry.currency,
    }


@router.get("/team/pending", response_model=list[PendingTeamPayment])
async def list_pending_team_payments(
    event_id: UUID,
    claims: Claims = Depends(get_claims),
    svc: PaymentService = Depends(get_payment_service),
) -> list[PendingTeamPayment]:
    """Teams awaiting payment — the organiser's confirmation queue."""
    if not claims.is_ctf_organizer:
        raise AppError(ErrorCode.NOT_ORGANIZER, "ctf_organizer role required")
    return [
        PendingTeamPayment(
            team_id=e.team_id,
            paid_by_user_id=e.paid_by_user_id,
            payment_status=e.payment_status,
            provider_reference=e.provider_reference,
            provider=e.provider,
            amount_cents=e.amount_cents,
            currency=e.currency,
        )
        for e in await svc.list_pending_teams(event_id)
    ]


class TeamEntryStatus(BaseModel):
    team_id: UUID
    payment_status: str
    settled: bool
    amount_cents: int
    currency: str | None
    paid_by_user_id: UUID | None


@router.get("/team/{team_id}/status", response_model=TeamEntryStatus)
async def team_entry_status(
    event_id: UUID,
    team_id: UUID,
    claims: Claims = Depends(get_claims),
    svc: PaymentService = Depends(get_payment_service),
) -> TeamEntryStatus:
    """Whether a team's entry is settled.

    Readable by any signed-in user, deliberately. Teammates need it to know
    whether they are waiting on their captain, and it reveals nothing beyond
    what the scoreboard already will — that this team is in the event.
    """
    entry = await svc.team_entry(event_id, team_id)
    return TeamEntryStatus(
        team_id=entry.team_id,
        payment_status=entry.payment_status,
        settled=entry.settled,
        amount_cents=entry.amount_cents,
        currency=entry.currency,
        paid_by_user_id=entry.paid_by_user_id,
    )
