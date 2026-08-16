"""Reusable FastAPI dependencies (auth, services, etc.)."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import Claims, JWTValidator
from app.core.errors import AppError, ErrorCode
from app.db.session import get_session
from app.services.challenges import ChallengeService
from app.services.events import ContentEventPublisher
from app.services.machines import MachineService
from app.services.paths import PathService
from app.services.search import SearchService


# =============================================================================
# Auth
# =============================================================================


def get_validator(request: Request) -> JWTValidator:
    validator: JWTValidator | None = getattr(request.app.state, "validator", None)
    if not validator:
        raise RuntimeError("JWT validator not initialized")
    return validator


def get_event_publisher(request: Request) -> ContentEventPublisher:
    publisher: ContentEventPublisher | None = getattr(request.app.state, "publisher", None)
    if not publisher:
        raise RuntimeError("Event publisher not initialized")
    return publisher


async def get_claims(
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
    validator: JWTValidator = Depends(get_validator),
) -> Claims:
    """Resolve JWT claims from the Authorization header."""
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
    """Optional claims — for endpoints viewable both anonymously and authed."""
    if not authorization:
        return None
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    try:
        return validator.validate(parts[1].strip())
    except AppError:
        return None


# =============================================================================
# Service factories
# =============================================================================


async def get_machine_service(
    session: AsyncSession = Depends(get_session),
) -> MachineService:
    return MachineService(session)


async def get_challenge_service(
    session: AsyncSession = Depends(get_session),
) -> ChallengeService:
    return ChallengeService(session)


async def get_path_service(session: AsyncSession = Depends(get_session)) -> PathService:
    return PathService(session)


async def get_search_service(session: AsyncSession = Depends(get_session)) -> SearchService:
    return SearchService(session)


# =============================================================================
# Pagination
# =============================================================================


def pagination(
    limit: int = 25,
    offset: int = 0,
) -> tuple[int, int]:
    if limit <= 0:
        limit = 25
    if limit > 100:
        limit = 100
    if offset < 0:
        offset = 0
    return limit, offset


# =============================================================================
# Request ID
# =============================================================================


def get_request_id(request: Request) -> str:
    rid = request.headers.get("X-Request-ID")
    if not rid:
        rid = str(uuid.uuid4())
    return rid
