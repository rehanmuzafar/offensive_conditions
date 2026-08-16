"""Challenge HTTP endpoints."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import (
    get_challenge_service,
    get_claims,
    get_event_publisher,
    get_optional_claims,
    get_request_id,
    pagination,
)
from app.core.auth import Claims
from app.core.errors import AppError, ErrorCode
from app.schemas import (
    ChallengeCreate,
    ChallengeList,
    ChallengeRead,
    ChallengeUpdate,
    PageMeta,
)
from app.services.challenges import ChallengeService
from app.services.events import ContentEventPublisher, EventType

router = APIRouter(prefix="/challenges", tags=["challenges"])


@router.get("", response_model=ChallengeList)
async def list_challenges(
    page: tuple[int, int] = Depends(pagination),
    status_filter: str | None = Query(None, alias="status"),
    difficulty: str | None = Query(None),
    category_id: UUID | None = Query(None),
    tags: list[str] | None = Query(None),
    search: str | None = Query(None, min_length=2, max_length=200),
    claims: Claims | None = Depends(get_optional_claims),
    svc: ChallengeService = Depends(get_challenge_service),
) -> ChallengeList:
    limit, offset = page
    viewer_tier = claims.tier if claims else "free"
    items, total = await svc.list_(
        viewer_tier=viewer_tier,
        status=status_filter,
        difficulty=difficulty,
        category_id=category_id,
        tag_slugs=tags,
        search=search,
        limit=limit,
        offset=offset,
        include_unpublished=bool(claims and claims.is_staff),
    )
    return ChallengeList(
        items=[ChallengeRead.model_validate(c) for c in items],
        meta=PageMeta(total=total, limit=limit, offset=offset, has_more=(offset + limit) < total),
    )


@router.get("/{challenge_id}", response_model=ChallengeRead)
async def get_challenge(
    challenge_id: UUID,
    claims: Claims | None = Depends(get_optional_claims),
    svc: ChallengeService = Depends(get_challenge_service),
) -> ChallengeRead:
    challenge = await svc.get(challenge_id)
    if challenge.status != "retired" and not (claims and claims.is_staff):
        challenge.walkthrough_markdown = None
    return ChallengeRead.model_validate(challenge)


@router.get("/by-slug/{slug}", response_model=ChallengeRead)
async def get_challenge_by_slug(
    slug: str,
    claims: Claims | None = Depends(get_optional_claims),
    svc: ChallengeService = Depends(get_challenge_service),
) -> ChallengeRead:
    challenge = await svc.get_by_slug(slug)
    if challenge.status != "retired" and not (claims and claims.is_staff):
        challenge.walkthrough_markdown = None
    return ChallengeRead.model_validate(challenge)


@router.post("", response_model=ChallengeRead, status_code=status.HTTP_201_CREATED)
async def create_challenge(
    body: ChallengeCreate,
    claims: Claims = Depends(get_claims),
    svc: ChallengeService = Depends(get_challenge_service),
    publisher: ContentEventPublisher = Depends(get_event_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> ChallengeRead:
    if not claims.is_content_creator:
        raise AppError(ErrorCode.NOT_CREATOR, "content_creator role required")
    challenge = await svc.create(creator_id=claims.user_id, data=body)
    await publisher.publish(
        event_type=EventType.CHALLENGE_CREATED,
        subject_id=challenge.id,
        actor_id=claims.user_id,
        payload={"slug": challenge.slug, "name": challenge.name},
        request_id=request_id,
    )
    return ChallengeRead.model_validate(challenge)


@router.patch("/{challenge_id}", response_model=ChallengeRead)
async def update_challenge(
    challenge_id: UUID,
    body: ChallengeUpdate,
    claims: Claims = Depends(get_claims),
    svc: ChallengeService = Depends(get_challenge_service),
) -> ChallengeRead:
    challenge = await svc.update(
        challenge_id, actor_id=claims.user_id, is_staff=claims.is_staff, data=body
    )
    return ChallengeRead.model_validate(challenge)


@router.post("/{challenge_id}/submit-for-review", response_model=ChallengeRead)
async def submit_challenge_for_review(
    challenge_id: UUID,
    claims: Claims = Depends(get_claims),
    svc: ChallengeService = Depends(get_challenge_service),
) -> ChallengeRead:
    challenge = await svc.transition_status(
        challenge_id, new_status="review", actor_id=claims.user_id, is_staff=claims.is_staff
    )
    return ChallengeRead.model_validate(challenge)


@router.post("/{challenge_id}/publish", response_model=ChallengeRead)
async def publish_challenge(
    challenge_id: UUID,
    claims: Claims = Depends(get_claims),
    svc: ChallengeService = Depends(get_challenge_service),
    publisher: ContentEventPublisher = Depends(get_event_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> ChallengeRead:
    challenge = await svc.transition_status(
        challenge_id, new_status="active", actor_id=claims.user_id, is_staff=claims.is_staff
    )
    await publisher.publish(
        event_type=EventType.CHALLENGE_PUBLISHED,
        subject_id=challenge_id,
        actor_id=claims.user_id,
        payload={"slug": challenge.slug},
        request_id=request_id,
    )
    return ChallengeRead.model_validate(challenge)


@router.post("/{challenge_id}/retire", response_model=ChallengeRead)
async def retire_challenge(
    challenge_id: UUID,
    claims: Claims = Depends(get_claims),
    svc: ChallengeService = Depends(get_challenge_service),
    publisher: ContentEventPublisher = Depends(get_event_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> ChallengeRead:
    challenge = await svc.transition_status(
        challenge_id, new_status="retired", actor_id=claims.user_id, is_staff=claims.is_staff
    )
    await publisher.publish(
        event_type=EventType.CHALLENGE_RETIRED,
        subject_id=challenge_id,
        actor_id=claims.user_id,
        payload={"slug": challenge.slug},
        request_id=request_id,
    )
    return ChallengeRead.model_validate(challenge)
