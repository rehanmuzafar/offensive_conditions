"""Event writeups: the captain's submission and the organiser's reading of it."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, Header, Response, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_claims, get_event_service
from app.db.session import get_session
from app.core.auth import Claims
from app.core.config import get_settings
from app.core.errors import AppError, ErrorCode
from app.models import EventParticipant
from app.services import EventService
from app.services.user_client import UserServiceClient
from app.services.writeups import ALLOWED, WriteupService

router = APIRouter(prefix="/events/{event_id}/writeup", tags=["writeups"])


class WriteupRead(BaseModel):
    id: UUID
    filename: str
    content_type: str
    size_bytes: int
    status: str
    submitted_at: str | None = None
    updated_at: str | None = None


def _view(w) -> dict:
    return {
        "id": str(w.id),
        "team_id": str(w.team_id) if w.team_id else None,
        "user_id": str(w.user_id) if w.user_id else None,
        "filename": w.filename,
        "content_type": w.content_type,
        "size_bytes": w.size_bytes,
        "status": w.status,
        "submitted_at": w.submitted_at.isoformat() if w.submitted_at else None,
        "updated_at": w.updated_at.isoformat() if w.updated_at else None,
    }


async def _my_entry(
    session: AsyncSession, event_id: UUID, user_id: UUID
) -> EventParticipant:
    row = await session.execute(
        select(EventParticipant).where(
            and_(EventParticipant.event_id == event_id, EventParticipant.user_id == user_id)
        )
    )
    participant = row.scalar_one_or_none()
    if not participant:
        raise AppError(ErrorCode.NOT_REGISTERED, "you are not registered for this event")
    return participant


async def _assert_may_submit(
    participant: EventParticipant, *, claims: Claims, authorization: str | None
) -> None:
    """A team's writeup is the captain's to send.

    Any member could otherwise turn in a half-finished draft on the team's
    behalf, and the submission is the thing the deadline and the prize hang on.
    Solo entries answer for themselves.
    """
    if participant.team_id is None:
        return
    await UserServiceClient(get_settings()).get_team_roster(
        participant.team_id, bearer=authorization or "", actor_id=claims.user_id
    )


@router.get("")
async def my_writeup(
    event_id: UUID,
    claims: Claims = Depends(get_claims),
    session: AsyncSession = Depends(get_session),
    svc: EventService = Depends(get_event_service),
) -> dict:
    """The viewer's own entry: the file if any, the deadline, and whether they owe one."""
    participant = await _my_entry(session, event_id, claims.user_id)
    event = await svc.get(event_id)
    writeup = await WriteupService(session).for_entry(
        event_id,
        team_id=participant.team_id,
        user_id=None if participant.team_id else participant.user_id,
    )
    return {
        "writeup": _view(writeup) if writeup else None,
        "deadline": event.writeup_deadline.isoformat() if event.writeup_deadline else None,
        "required_top_n": event.writeup_required_top_n,
        "allowed_extensions": sorted(ALLOWED),
    }


@router.post("", status_code=status.HTTP_201_CREATED)
async def upload_writeup(
    event_id: UUID,
    file: Annotated[UploadFile, File(description="pdf, docx, md or txt")],
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
    claims: Claims = Depends(get_claims),
    session: AsyncSession = Depends(get_session),
    svc: EventService = Depends(get_event_service),
) -> dict:
    participant = await _my_entry(session, event_id, claims.user_id)
    await _assert_may_submit(participant, claims=claims, authorization=authorization)
    event = await svc.get(event_id)

    writeup = await WriteupService(session).upload(
        event,
        team_id=participant.team_id,
        user_id=None if participant.team_id else participant.user_id,
        uploader_id=claims.user_id,
        filename=file.filename or "",
        data=await file.read(),
    )
    return _view(writeup)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_writeup(
    event_id: UUID,
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
    claims: Claims = Depends(get_claims),
    session: AsyncSession = Depends(get_session),
) -> None:
    """Remove a draft, so a captain who spotted a mistake can upload again."""
    participant = await _my_entry(session, event_id, claims.user_id)
    await _assert_may_submit(participant, claims=claims, authorization=authorization)

    service = WriteupService(session)
    writeup = await service.for_entry(
        event_id,
        team_id=participant.team_id,
        user_id=None if participant.team_id else participant.user_id,
    )
    if not writeup:
        raise AppError(ErrorCode.NOT_FOUND, "there is nothing to remove")
    await service.remove(writeup)


@router.post("/turn-in")
async def turn_in(
    event_id: UUID,
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
    claims: Claims = Depends(get_claims),
    session: AsyncSession = Depends(get_session),
    svc: EventService = Depends(get_event_service),
) -> dict:
    """Submit it. This is the act the deadline measures, and it is final."""
    participant = await _my_entry(session, event_id, claims.user_id)
    await _assert_may_submit(participant, claims=claims, authorization=authorization)

    service = WriteupService(session)
    writeup = await service.for_entry(
        event_id,
        team_id=participant.team_id,
        user_id=None if participant.team_id else participant.user_id,
    )
    if not writeup:
        raise AppError(ErrorCode.VALIDATION, "upload a writeup before turning it in")
    event = await svc.get(event_id)
    return _view(await service.turn_in(event, writeup))


# =============================================================================
# Organiser
# =============================================================================

admin_router = APIRouter(prefix="/events/{event_id}/writeups", tags=["writeups"])


@admin_router.get("")
async def list_writeups(
    event_id: UUID,
    claims: Claims = Depends(get_claims),
    session: AsyncSession = Depends(get_session),
    svc: EventService = Depends(get_event_service),
) -> dict:
    """Every writeup, joined to where its team stands.

    The organiser is judging a writeup against a result, so the standing is part
    of the row rather than something to go and look up: points, first bloods and
    rank sit next to the file.
    """
    event = await svc.get(event_id)
    if not claims.is_ctf_organizer and event.created_by != claims.user_id:
        raise AppError(ErrorCode.NOT_ORGANIZER, "only the organizer can read writeups")

    entries, eliminated, _ = await svc.get_board(
        event_id, viewer_is_organizer=True, limit=10_000
    )
    standing: dict[str, dict] = {}
    for e in list(entries) + list(eliminated):
        key = str(e.team_id) if e.team_id else f"user:{e.user_id}"
        standing[key] = {
            "rank": e.rank,
            "display_name": e.display_name,
            "points": e.points,
            "first_bloods": e.first_bloods,
            "solve_count": e.solve_count,
        }

    rows = await WriteupService(session).list_for_event(event_id)
    items = []
    for w in rows:
        key = str(w.team_id) if w.team_id else f"user:{w.user_id}"
        items.append({**_view(w), "standing": standing.get(key)})

    return {
        "items": items,
        "deadline": event.writeup_deadline.isoformat() if event.writeup_deadline else None,
        "required_top_n": event.writeup_required_top_n,
        # Who owed one and did not send it — the organiser's reason for the
        # eliminations showing on the board.
        "eliminated": [
            {
                "rank": e.rank,
                "display_name": e.display_name,
                "team_id": str(e.team_id) if e.team_id else None,
                "user_id": str(e.user_id) if e.user_id else None,
                "points": e.points,
            }
            for e in eliminated
        ],
    }


@admin_router.get("/{writeup_id}/content")
async def read_writeup(
    event_id: UUID,
    writeup_id: UUID,
    claims: Claims = Depends(get_claims),
    session: AsyncSession = Depends(get_session),
    svc: EventService = Depends(get_event_service),
) -> Response:
    """Stream a writeup for reading in the browser.

    Served through the service rather than from a presigned URL so the reader's
    role is checked on every request — a presigned link outlives the check and
    can be forwarded to anyone. `Content-Disposition: inline` because the point
    is to read it here, not to collect a folder of downloads.
    """
    event = await svc.get(event_id)
    if not claims.is_ctf_organizer and event.created_by != claims.user_id:
        raise AppError(ErrorCode.NOT_ORGANIZER, "only the organizer can read writeups")

    service = WriteupService(session)
    writeup = await service.get(writeup_id)
    if writeup.event_id != event_id:
        raise AppError(ErrorCode.NOT_FOUND, "writeup not found")

    body, content_type, kind = service.render(writeup)
    return Response(
        content=body,
        media_type=content_type,
        headers={
            "Content-Disposition": f'inline; filename="{writeup.filename}"',
            "X-Writeup-Kind": kind,
            # Never let a stored file be interpreted as something executable.
            "X-Content-Type-Options": "nosniff",
        },
    )
