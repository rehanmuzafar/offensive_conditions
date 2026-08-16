"""Learning path HTTP endpoints."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from app.api.deps import (
    get_claims,
    get_event_publisher,
    get_optional_claims,
    get_path_service,
    get_request_id,
    pagination,
)
from app.core.auth import Claims
from app.schemas import (
    ModuleCompleteRequest,
    ModuleCompleteResponse,
    PageMeta,
    PathDetailRead,
    PathEnrollmentRead,
    PathList,
    PathModuleRead,
    PathProgressRead,
    PathRead,
)
from app.services.events import ContentEventPublisher, EventType
from app.services.paths import PathService

router = APIRouter(prefix="/paths", tags=["paths"])


@router.get("", response_model=PathList)
async def list_paths(
    page: tuple[int, int] = Depends(pagination),
    difficulty: str | None = Query(None),
    category_id: UUID | None = Query(None),
    claims: Claims | None = Depends(get_optional_claims),
    svc: PathService = Depends(get_path_service),
) -> PathList:
    limit, offset = page
    viewer_tier = claims.tier if claims else "free"
    items, total = await svc.list_(
        viewer_tier=viewer_tier,
        difficulty=difficulty,
        category_id=category_id,
        limit=limit,
        offset=offset,
    )
    return PathList(
        items=[PathRead.model_validate(p) for p in items],
        meta=PageMeta(total=total, limit=limit, offset=offset, has_more=(offset + limit) < total),
    )


@router.get("/me/enrolled", response_model=list[PathEnrollmentRead])
async def list_my_enrollments(
    claims: Claims = Depends(get_claims),
    svc: PathService = Depends(get_path_service),
) -> list[PathEnrollmentRead]:
    items = await svc.list_my_enrollments(claims.user_id)
    return [PathEnrollmentRead.model_validate(e) for e in items]


@router.get("/{path_id}", response_model=PathDetailRead)
async def get_path(
    path_id: UUID,
    svc: PathService = Depends(get_path_service),
) -> PathDetailRead:
    path = await svc.get(path_id)
    detail = PathDetailRead.model_validate(path)
    detail.modules = [PathModuleRead.model_validate(m) for m in path.modules]
    return detail


@router.get("/by-slug/{slug}", response_model=PathDetailRead)
async def get_path_by_slug(
    slug: str,
    svc: PathService = Depends(get_path_service),
) -> PathDetailRead:
    path = await svc.get_by_slug(slug)
    detail = PathDetailRead.model_validate(path)
    detail.modules = [PathModuleRead.model_validate(m) for m in path.modules]
    return detail


@router.post("/{path_id}/enroll", response_model=PathEnrollmentRead)
async def enroll_path(
    path_id: UUID,
    claims: Claims = Depends(get_claims),
    svc: PathService = Depends(get_path_service),
    publisher: ContentEventPublisher = Depends(get_event_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> PathEnrollmentRead:
    enrollment = await svc.enroll(path_id, user_id=claims.user_id)
    await publisher.publish(
        event_type=EventType.PATH_ENROLLED,
        subject_id=path_id,
        actor_id=claims.user_id,
        payload={"path_id": str(path_id)},
        request_id=request_id,
    )
    return PathEnrollmentRead.model_validate(enrollment)


@router.get("/{path_id}/progress", response_model=PathProgressRead)
async def get_progress(
    path_id: UUID,
    claims: Claims = Depends(get_claims),
    svc: PathService = Depends(get_path_service),
) -> PathProgressRead:
    data = await svc.get_progress(path_id, user_id=claims.user_id)
    return PathProgressRead(
        enrollment=PathEnrollmentRead.model_validate(data["enrollment"]),
        modules_completed=data["modules_completed"],
        modules_total=data["modules_total"],
        next_module_id=data["next_module_id"],
    )


@router.post(
    "/{path_id}/modules/{module_id}/complete",
    response_model=ModuleCompleteResponse,
)
async def complete_module(
    path_id: UUID,
    module_id: UUID,
    body: ModuleCompleteRequest,
    claims: Claims = Depends(get_claims),
    svc: PathService = Depends(get_path_service),
    publisher: ContentEventPublisher = Depends(get_event_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> ModuleCompleteResponse:
    result = await svc.complete_module(module_id, user_id=claims.user_id, answers=body.answers)
    if result["completed"]:
        await publisher.publish(
            event_type=EventType.PATH_MODULE_COMPLETED,
            subject_id=module_id,
            actor_id=claims.user_id,
            payload={
                "path_id": str(path_id),
                "points": result["points_earned"],
            },
            request_id=request_id,
        )
    return ModuleCompleteResponse(**result)
