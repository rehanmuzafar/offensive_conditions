"""Team chat for a CTF event."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query
from pydantic import BaseModel, Field
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_claims, get_registration_service, get_ws_broker
from app.core.auth import Claims
from app.core.errors import AppError, ErrorCode
from app.db.session import get_session
from app.models import ChatMessage
from app.services.registration import RegistrationService
from app.ws.broker import WebSocketBroker

router = APIRouter(prefix="/events/{event_id}/chat", tags=["chat"])


class MessageRead(BaseModel):
    id: UUID
    user_id: UUID
    username: str
    body: str
    edited: bool
    deleted: bool
    created_at: str


class SendMessage(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


class EditMessage(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


def _serialize(m: ChatMessage) -> MessageRead:
    return MessageRead(
        id=m.id,
        user_id=m.user_id,
        username=m.username or str(m.user_id)[:8],
        # A deleted message keeps its slot so the thread does not reshuffle.
        body="" if m.deleted_at else m.body,
        edited=m.edited_at is not None,
        deleted=m.deleted_at is not None,
        created_at=m.created_at.isoformat(),
    )


async def _participation(
    event_id: UUID, claims: Claims, reg: RegistrationService, bearer: str | None
):
    p = await reg.get_my_participation(event_id, user_id=claims.user_id, bearer=bearer)
    if p is None:
        raise AppError(ErrorCode.NOT_REGISTERED, "register for the event first")
    return p


@router.get("", response_model=list[MessageRead])
async def list_messages(
    event_id: UUID,
    limit: int = Query(50, ge=1, le=200),
    before: datetime | None = Query(None, description="cursor: created_at of the oldest row you have"),
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
    claims: Claims = Depends(get_claims),
    reg: RegistrationService = Depends(get_registration_service),
    session: AsyncSession = Depends(get_session),
) -> list[MessageRead]:
    """Newest-first page of the team's messages."""
    p = await _participation(event_id, claims, reg, authorization)
    stmt = (
        select(ChatMessage)
        .where(ChatMessage.participant_id == p.id)
        .order_by(ChatMessage.created_at.desc())
        .limit(limit)
    )
    if before is not None:
        stmt = stmt.where(ChatMessage.created_at < before)
    rows = (await session.execute(stmt)).scalars().all()
    # Hand back oldest-first so the client can append without reversing.
    return [_serialize(m) for m in reversed(list(rows))]


@router.post("", response_model=MessageRead, status_code=201)
async def send_message(
    event_id: UUID,
    body: SendMessage,
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
    claims: Claims = Depends(get_claims),
    reg: RegistrationService = Depends(get_registration_service),
    session: AsyncSession = Depends(get_session),
    broker: WebSocketBroker = Depends(get_ws_broker),
) -> MessageRead:
    p = await _participation(event_id, claims, reg, authorization)
    msg = ChatMessage(
        event_id=event_id,
        participant_id=p.id,
        user_id=claims.user_id,
        username=claims.username or "",
        body=body.body.strip(),
    )
    session.add(msg)
    await session.flush()
    await session.refresh(msg)

    out = _serialize(msg)
    if p.team_id:
        await broker.to_team(
            event_id, p.team_id, {"type": "chat", "message": out.model_dump(mode="json")}
        )
    return out


@router.patch("/{message_id}", response_model=MessageRead)
async def edit_message(
    event_id: UUID,
    message_id: UUID,
    body: EditMessage,
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
    claims: Claims = Depends(get_claims),
    reg: RegistrationService = Depends(get_registration_service),
    session: AsyncSession = Depends(get_session),
    broker: WebSocketBroker = Depends(get_ws_broker),
) -> MessageRead:
    p = await _participation(event_id, claims, reg, authorization)
    msg = (
        await session.execute(
            select(ChatMessage).where(
                and_(ChatMessage.id == message_id, ChatMessage.participant_id == p.id)
            )
        )
    ).scalar_one_or_none()
    if msg is None:
        raise AppError(ErrorCode.VALIDATION, "message not found")
    # Only the author edits their own words, even inside one team.
    if msg.user_id != claims.user_id:
        raise AppError(ErrorCode.FORBIDDEN, "you can only edit your own messages")
    if msg.deleted_at:
        raise AppError(ErrorCode.VALIDATION, "message was deleted")

    msg.body = body.body.strip()
    msg.edited_at = datetime.now(timezone.utc)
    await session.flush()
    await session.refresh(msg)

    out = _serialize(msg)
    if p.team_id:
        await broker.to_team(
            event_id, p.team_id, {"type": "chat.edited", "message": out.model_dump(mode="json")}
        )
    return out


@router.delete("/{message_id}", response_model=MessageRead)
async def delete_message(
    event_id: UUID,
    message_id: UUID,
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
    claims: Claims = Depends(get_claims),
    reg: RegistrationService = Depends(get_registration_service),
    session: AsyncSession = Depends(get_session),
    broker: WebSocketBroker = Depends(get_ws_broker),
) -> MessageRead:
    p = await _participation(event_id, claims, reg, authorization)
    msg = (
        await session.execute(
            select(ChatMessage).where(
                and_(ChatMessage.id == message_id, ChatMessage.participant_id == p.id)
            )
        )
    ).scalar_one_or_none()
    if msg is None:
        raise AppError(ErrorCode.VALIDATION, "message not found")
    if msg.user_id != claims.user_id:
        raise AppError(ErrorCode.FORBIDDEN, "you can only delete your own messages")

    msg.deleted_at = datetime.now(timezone.utc)
    await session.flush()
    await session.refresh(msg)

    out = _serialize(msg)
    if p.team_id:
        await broker.to_team(
            event_id, p.team_id, {"type": "chat.deleted", "message": out.model_dump(mode="json")}
        )
    return out
