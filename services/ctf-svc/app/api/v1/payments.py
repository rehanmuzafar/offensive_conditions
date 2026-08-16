"""Entry-fee payment endpoints for paid CTF events."""

from __future__ import annotations

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_claims, get_request_id
from app.core.auth import Claims
from app.core.config import get_settings
from app.core.errors import AppError, ErrorCode
from app.db.session import get_session
from app.services.payments import PaymentService

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
