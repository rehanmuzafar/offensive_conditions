"""Challenge progress + assignment endpoints (team-scoped)."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_claims, get_registration_service, get_ws_broker
from app.core.auth import Claims
from app.core.errors import AppError, ErrorCode
from app.db.session import get_session
from app.services.progress import ProgressService
from app.services.registration import RegistrationService
from app.ws.broker import WebSocketBroker

router = APIRouter(prefix="/events/{event_id}/progress", tags=["progress"])


async def get_progress_service(session: AsyncSession = Depends(get_session)) -> ProgressService:
    return ProgressService(session)


class ProgressRead(BaseModel):
    challenge_id: UUID
    status: str
    note: str | None = None
    assigned_to_user_id: UUID | None = None
    assigned_by_user_id: UUID | None = None
    updated_by_user_id: UUID | None = None
    updated_at: str


class ProgressUpdate(BaseModel):
    status: str | None = Field(default=None)
    note: str | None = Field(default=None, max_length=500)
    # Hand the challenge to a teammate; `unassign` clears it.
    assign_to_user_id: UUID | None = None
    unassign: bool = False


def _serialize(r) -> ProgressRead:
    return ProgressRead(
        challenge_id=r.challenge_id,
        status=r.status,
        note=r.note,
        assigned_to_user_id=r.assigned_to_user_id,
        assigned_by_user_id=r.assigned_by_user_id,
        updated_by_user_id=r.updated_by_user_id,
        updated_at=r.updated_at.isoformat(),
    )


async def _participant_id(
    event_id: UUID, claims: Claims, reg: RegistrationService, bearer: str | None
) -> UUID:
    p = await reg.get_my_participation(event_id, user_id=claims.user_id, bearer=bearer)
    if p is None:
        raise AppError(ErrorCode.NOT_REGISTERED, "register for the event first")
    return p.id


@router.get("", response_model=list[ProgressRead])
async def list_progress(
    event_id: UUID,
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
    claims: Claims = Depends(get_claims),
    reg: RegistrationService = Depends(get_registration_service),
    svc: ProgressService = Depends(get_progress_service),
) -> list[ProgressRead]:
    """Everything the caller's team has claimed or flagged on this event."""
    pid = await _participant_id(event_id, claims, reg, authorization)
    return [_serialize(r) for r in await svc.list_for_participant(event_id, participant_id=pid)]


@router.put("/{challenge_id}", response_model=ProgressRead)
async def set_progress(
    event_id: UUID,
    challenge_id: UUID,
    body: ProgressUpdate,
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
    claims: Claims = Depends(get_claims),
    reg: RegistrationService = Depends(get_registration_service),
    svc: ProgressService = Depends(get_progress_service),
    broker: WebSocketBroker = Depends(get_ws_broker),
) -> ProgressRead:
    """Set a status, leave a note, or hand the challenge to a teammate."""
    participation = await reg.get_my_participation(
        event_id, user_id=claims.user_id, bearer=authorization
    )
    if participation is None:
        raise AppError(ErrorCode.NOT_REGISTERED, "register for the event first")
    pid = participation.id
    row = await svc.set_progress(
        event_id,
        challenge_id,
        participant_id=pid,
        actor_id=claims.user_id,
        status=body.status,
        note=body.note,
        assign_to=body.assign_to_user_id,
        unassign=body.unassign,
    )

    # Push to the team so a teammate's board updates without waiting for a poll.
    # Scoped to the team channel: nobody else has any business seeing it.
    if participation.team_id:
        await broker.to_team(
            event_id,
            participation.team_id,
            {
                "type": "progress",
                "challenge_id": str(challenge_id),
                "status": row.status,
                "assigned_to_user_id": str(row.assigned_to_user_id)
                if row.assigned_to_user_id
                else None,
                "updated_by_user_id": str(claims.user_id),
            },
        )

    return _serialize(row)
