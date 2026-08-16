"""Machine HTTP endpoints."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import (
    get_claims,
    get_event_publisher,
    get_machine_service,
    get_optional_claims,
    get_request_id,
    pagination,
)
from app.core.auth import Claims
from app.schemas import (
    MachineCreate,
    MachineList,
    MachineRate,
    MachineRead,
    MachineStatsRead,
    MachineUpdate,
    MachineReviewRead,
    PageMeta,
)
from app.services.events import ContentEventPublisher, EventType
from app.services.machines import MachineService

router = APIRouter(prefix="/machines", tags=["machines"])


# =============================================================================
# Read
# =============================================================================


@router.get("", response_model=MachineList)
async def list_machines(
    page: tuple[int, int] = Depends(pagination),
    status_filter: str | None = Query(None, alias="status"),
    difficulty: str | None = Query(None),
    os: str | None = Query(None),
    category_id: UUID | None = Query(None),
    tags: list[str] | None = Query(None),
    search: str | None = Query(None, min_length=2, max_length=200),
    claims: Claims | None = Depends(get_optional_claims),
    svc: MachineService = Depends(get_machine_service),
) -> MachineList:
    limit, offset = page
    viewer_tier = claims.tier if claims else "free"
    items, total = await svc.list_(
        viewer_tier=viewer_tier,
        status=status_filter,
        difficulty=difficulty,
        os=os,
        category_id=category_id,
        tag_slugs=tags,
        search=search,
        limit=limit,
        offset=offset,
        include_unpublished=bool(claims and claims.is_staff),
    )
    return MachineList(
        items=[MachineRead.model_validate(m) for m in items],
        meta=PageMeta(total=total, limit=limit, offset=offset, has_more=(offset + limit) < total),
    )


@router.get("/{machine_id}", response_model=MachineRead)
async def get_machine(
    machine_id: UUID,
    claims: Claims | None = Depends(get_optional_claims),
    svc: MachineService = Depends(get_machine_service),
) -> MachineRead:
    machine = await svc.get(machine_id)
    # Walkthroughs hidden until retired
    if machine.status != "retired" and not (claims and claims.is_staff):
        machine.walkthrough_markdown = None
    return MachineRead.model_validate(machine)


@router.get("/by-slug/{slug}", response_model=MachineRead)
async def get_machine_by_slug(
    slug: str,
    claims: Claims | None = Depends(get_optional_claims),
    svc: MachineService = Depends(get_machine_service),
) -> MachineRead:
    machine = await svc.get_by_slug(slug)
    if machine.status != "retired" and not (claims and claims.is_staff):
        machine.walkthrough_markdown = None
    return MachineRead.model_validate(machine)


@router.get("/{machine_id}/stats", response_model=MachineStatsRead)
async def get_machine_stats(
    machine_id: UUID,
    svc: MachineService = Depends(get_machine_service),
) -> MachineStatsRead:
    stats = await svc.get_stats(machine_id)
    return MachineStatsRead(**stats)


@router.get("/{machine_id}/reviews")
async def list_reviews(
    machine_id: UUID,
    page: tuple[int, int] = Depends(pagination),
    svc: MachineService = Depends(get_machine_service),
) -> dict:
    limit, offset = page
    items, total = await svc.list_reviews(machine_id, limit=limit, offset=offset)
    return {
        "items": [MachineReviewRead.model_validate(r) for r in items],
        "meta": PageMeta(total=total, limit=limit, offset=offset, has_more=(offset + limit) < total),
    }


# =============================================================================
# Write (creators + admins)
# =============================================================================


@router.post("", response_model=MachineRead, status_code=status.HTTP_201_CREATED)
async def create_machine(
    body: MachineCreate,
    claims: Claims = Depends(get_claims),
    svc: MachineService = Depends(get_machine_service),
    publisher: ContentEventPublisher = Depends(get_event_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> MachineRead:
    if not claims.is_content_creator:
        from app.core.errors import AppError, ErrorCode
        raise AppError(ErrorCode.NOT_CREATOR, "content_creator role required")
    machine = await svc.create(creator_id=claims.user_id, data=body)
    await publisher.publish(
        event_type=EventType.MACHINE_CREATED,
        subject_id=machine.id,
        actor_id=claims.user_id,
        payload={"slug": machine.slug, "name": machine.name},
        request_id=request_id,
    )
    return MachineRead.model_validate(machine)


@router.patch("/{machine_id}", response_model=MachineRead)
async def update_machine(
    machine_id: UUID,
    body: MachineUpdate,
    claims: Claims = Depends(get_claims),
    svc: MachineService = Depends(get_machine_service),
    publisher: ContentEventPublisher = Depends(get_event_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> MachineRead:
    machine = await svc.update(
        machine_id, actor_id=claims.user_id, is_staff=claims.is_staff, data=body
    )
    await publisher.publish(
        event_type=EventType.MACHINE_UPDATED,
        subject_id=machine_id,
        actor_id=claims.user_id,
        payload={"fields": list(body.model_dump(exclude_unset=True).keys())},
        request_id=request_id,
    )
    return MachineRead.model_validate(machine)


@router.post("/{machine_id}/submit-for-review", response_model=MachineRead)
async def submit_for_review(
    machine_id: UUID,
    claims: Claims = Depends(get_claims),
    svc: MachineService = Depends(get_machine_service),
) -> MachineRead:
    machine = await svc.transition_status(
        machine_id, new_status="review", actor_id=claims.user_id, is_staff=claims.is_staff
    )
    return MachineRead.model_validate(machine)


@router.post("/{machine_id}/publish", response_model=MachineRead)
async def publish_machine(
    machine_id: UUID,
    claims: Claims = Depends(get_claims),
    svc: MachineService = Depends(get_machine_service),
    publisher: ContentEventPublisher = Depends(get_event_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> MachineRead:
    machine = await svc.transition_status(
        machine_id,
        new_status="active",
        actor_id=claims.user_id,
        is_staff=claims.is_staff,
        reviewer_id=claims.user_id,
    )
    await publisher.publish(
        event_type=EventType.MACHINE_PUBLISHED,
        subject_id=machine_id,
        actor_id=claims.user_id,
        payload={"slug": machine.slug},
        request_id=request_id,
    )
    return MachineRead.model_validate(machine)


@router.post("/{machine_id}/retire", response_model=MachineRead)
async def retire_machine(
    machine_id: UUID,
    claims: Claims = Depends(get_claims),
    svc: MachineService = Depends(get_machine_service),
    publisher: ContentEventPublisher = Depends(get_event_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> MachineRead:
    machine = await svc.transition_status(
        machine_id, new_status="retired", actor_id=claims.user_id, is_staff=claims.is_staff
    )
    await publisher.publish(
        event_type=EventType.MACHINE_RETIRED,
        subject_id=machine_id,
        actor_id=claims.user_id,
        payload={"slug": machine.slug},
        request_id=request_id,
    )
    return MachineRead.model_validate(machine)


# =============================================================================
# Ratings
# =============================================================================


@router.post("/{machine_id}/rate", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def rate_machine(
    machine_id: UUID,
    body: MachineRate,
    claims: Claims = Depends(get_claims),
    svc: MachineService = Depends(get_machine_service),
    publisher: ContentEventPublisher = Depends(get_event_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> None:
    await svc.rate(machine_id, user_id=claims.user_id, data=body)
    await publisher.publish(
        event_type=EventType.MACHINE_RATED,
        subject_id=machine_id,
        actor_id=claims.user_id,
        payload={"rating": body.rating, "difficulty_vote": body.difficulty_vote},
        request_id=request_id,
    )
