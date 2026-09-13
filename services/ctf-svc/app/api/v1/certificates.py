"""Certificate endpoints: check, claim, and public verification."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_claims
from app.core.auth import Claims
from app.core.errors import AppError, ErrorCode
from app.db.session import get_session
from app.services.certificates import CertificateService

router = APIRouter(tags=["certificates"])


class Eligibility(BaseModel):
    eligible: bool
    reason: str | None = None
    message: str | None = None
    already_claimed: bool = False
    certificate_no: str | None = None


class Certificate(BaseModel):
    certificate_no: str
    claimed_at: str
    revoked: bool
    snapshot: dict[str, Any]


def _svc(session: AsyncSession = Depends(get_session)) -> CertificateService:
    return CertificateService(session)


@router.get("/events/{event_id}/certificate", response_model=Eligibility)
async def check(
    event_id: UUID,
    claims: Claims = Depends(get_claims),
    svc: CertificateService = Depends(_svc),
) -> Eligibility:
    """Whether the signed-in player can claim, and why not if they cannot.

    The button reads this. A reason is returned rather than a bare false so it
    can say what is actually missing instead of going quietly grey.
    """
    return Eligibility(**await svc.eligibility(event_id, claims.user_id))


@router.post("/events/{event_id}/certificate", response_model=Certificate)
async def claim(
    event_id: UUID,
    claims: Claims = Depends(get_claims),
    svc: CertificateService = Depends(_svc),
) -> Certificate:
    """Claim it. Claiming twice returns the same document, not a second one."""
    cert = await svc.claim(event_id, claims.user_id, username=claims.username or "")
    return Certificate(
        certificate_no=cert.certificate_no,
        claimed_at=cert.claimed_at.isoformat(),
        revoked=not cert.valid,
        snapshot=cert.snapshot,
    )


@router.get("/certificates/{certificate_no}", response_model=Certificate)
async def verify(
    certificate_no: str,
    svc: CertificateService = Depends(_svc),
) -> Certificate:
    """Public verification — deliberately unauthenticated.

    The point of a certificate is that somebody else can check it. Requiring an
    account to do that would defeat it: the people verifying are employers and
    organisers who have no reason to have one.

    A revoked certificate is returned rather than hidden, marked revoked. The
    holder may still be showing a copy, and "this was issued and then revoked"
    is the honest answer to give — "no such certificate" would look like a
    lookup failure.
    """
    cert = await svc.by_number(certificate_no)
    if cert is None:
        raise AppError(ErrorCode.NOT_FOUND, "no certificate with that number")
    return Certificate(
        certificate_no=cert.certificate_no,
        claimed_at=cert.claimed_at.isoformat(),
        revoked=not cert.valid,
        snapshot=cert.snapshot,
    )
