"""Reusable FastAPI dependencies."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import Depends, Header, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import Claims, JWTValidator
from app.core.errors import AppError, ErrorCode
from app.db.session import get_session
from app.services import (
    BookmarkService,
    CommentService,
    VoteService,
    WriteupEventPublisher,
    WriteupService,
)


def get_validator(request: Request) -> JWTValidator:
    v: JWTValidator | None = getattr(request.app.state, "validator", None)
    if not v:
        raise RuntimeError("JWT validator not initialized")
    return v


def get_publisher(request: Request) -> WriteupEventPublisher:
    p: WriteupEventPublisher | None = getattr(request.app.state, "publisher", None)
    if not p:
        raise RuntimeError("Event publisher not initialized")
    return p


async def get_claims(
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
    validator: JWTValidator = Depends(get_validator),
) -> Claims:
    if not authorization:
        raise AppError(ErrorCode.UNAUTHORIZED, "missing authorization header")
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise AppError(ErrorCode.UNAUTHORIZED, "invalid authorization header")
    return validator.validate(parts[1].strip())


async def get_optional_claims(
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
    validator: JWTValidator = Depends(get_validator),
) -> Claims | None:
    if not authorization:
        return None
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    try:
        return validator.validate(parts[1].strip())
    except AppError:
        return None


def pagination(limit: int = 25, offset: int = 0) -> tuple[int, int]:
    if limit <= 0:
        limit = 25
    if limit > 100:
        limit = 100
    if offset < 0:
        offset = 0
    return limit, offset


def get_request_id(request: Request) -> str:
    rid = request.headers.get("X-Request-ID")
    if not rid:
        rid = str(uuid.uuid4())
    return rid


async def get_writeup_service(
    session: AsyncSession = Depends(get_session),
) -> WriteupService:
    return WriteupService(session)


async def get_comment_service(
    session: AsyncSession = Depends(get_session),
) -> CommentService:
    return CommentService(session)


async def get_vote_service(session: AsyncSession = Depends(get_session)) -> VoteService:
    return VoteService(session)


async def get_bookmark_service(
    session: AsyncSession = Depends(get_session),
) -> BookmarkService:
    return BookmarkService(session)
