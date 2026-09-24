"""Bounty program HTTP endpoints."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import (
    get_claims,
    get_optional_claims,
    get_program_service,
    get_publisher,
    get_request_id,
    pagination,
)
from app.core.auth import Claims
from app.core.errors import AppError, ErrorCode
from app.schemas import (
    PageMeta,
    ProgramCreate,
    ProgramDetailRead,
    ProgramList,
    ProgramCardList,
    ThanksEntry,
    CollaboratorEntry,
    ProgramUpdateRead,
    ProgramUpdateCreate,
    ProgramCardRead,
    AssetTypeCount,
    ProgramRead,
    ProgramUpdate,
    RewardTier,
    ScopeItem,
)
from app.services import BountyEventPublisher, EventType, ProgramService

router = APIRouter(prefix="/programs", tags=["programs"])
admin_router = APIRouter(prefix="/admin/programs", tags=["programs"])


def _to_read(program) -> ProgramRead:
    return ProgramRead.model_validate(program)


def _to_detail(program) -> ProgramDetailRead:
    return ProgramDetailRead.model_validate(program)


# =============================================================================
# Public reads
# =============================================================================


@router.get("", response_model=ProgramCardList)
async def list_programs(
    page: tuple[int, int] = Depends(pagination),
    q: str | None = Query(None, min_length=2, max_length=200),
    asset_type: str | None = Query(None, description="Only programs with this asset type in scope"),
    has_bounty: bool | None = Query(None, description="Only programs that pay"),
    claims: Claims | None = Depends(get_optional_claims),
    svc: ProgramService = Depends(get_program_service),
) -> ProgramCardList:
    """The discovery grid.

    Carries the card aggregates — scope breakdown, distinct hackers, measured
    response efficiency — because every one of them is on the card and fetching
    them per program would be sixty round trips for a page of twenty.
    """
    limit, offset = page
    items, total = await svc.list_(
        viewer_is_owner=False,
        search=q,
        asset_type=asset_type,
        has_bounty=has_bounty,
        limit=limit,
        offset=offset,
    )
    stats = await svc.card_stats([p.id for p in items])
    cards = []
    for p in items:
        card = ProgramCardRead.model_validate(p, from_attributes=True)
        s = stats.get(p.id, {})
        card.asset_counts = [AssetTypeCount(**a) for a in s.get("asset_counts", [])]
        card.hackers = s.get("hackers", 0)
        card.response_efficiency = s.get("response_efficiency")
        cards.append(card)
    return ProgramCardList(
        items=cards,
        meta=PageMeta(
            total=total, limit=limit, offset=offset, has_more=(offset + limit) < total
        ),
    )


@router.get("/{slug}/thanks", response_model=list[ThanksEntry])
async def program_thanks(
    slug: str,
    svc: ProgramService = Depends(get_program_service),
) -> list[ThanksEntry]:
    """Who found what here, ranked. Public: it is a credit page."""
    program = await svc.get_by_slug(slug)
    return [ThanksEntry(**r) for r in await svc.thanks(program.id)]


@router.get("/{slug}/collaborators", response_model=list[CollaboratorEntry])
async def program_collaborators(
    slug: str,
    svc: ProgramService = Depends(get_program_service),
) -> list[CollaboratorEntry]:
    program = await svc.get_by_slug(slug)
    return [CollaboratorEntry(**r) for r in await svc.collaborators(program.id)]


@router.get("/{slug}/updates", response_model=list[ProgramUpdateRead])
async def program_updates(
    slug: str,
    svc: ProgramService = Depends(get_program_service),
) -> list[ProgramUpdateRead]:
    program = await svc.get_by_slug(slug)
    return [ProgramUpdateRead(**r) for r in await svc.updates(program.id)]


@router.get("/{slug}", response_model=ProgramDetailRead)
async def get_program(
    slug: str,
    svc: ProgramService = Depends(get_program_service),
) -> ProgramDetailRead:
    program = await svc.get_by_slug(slug)
    if program.visibility == "private":
        raise AppError(ErrorCode.PROGRAM_NOT_FOUND, "program not found")
    return _to_detail(program)


@router.get("/{slug}/scope")
async def get_program_scope(
    slug: str,
    svc: ProgramService = Depends(get_program_service),
) -> dict:
    program = await svc.get_by_slug(slug)
    scope = await svc.get_scope(program.id)
    return {
        "items": [
            {
                "asset_type": s.asset_type,
                "asset_identifier": s.asset_identifier,
                "severity_max": s.severity_max,
                "in_scope": s.in_scope,
                "notes": s.notes,
            }
            for s in scope
        ]
    }


@router.get("/{slug}/rewards")
async def get_program_rewards(
    slug: str,
    svc: ProgramService = Depends(get_program_service),
) -> dict:
    program = await svc.get_by_slug(slug)
    rewards = await svc.get_rewards(program.id)
    return {
        "currency": program.currency,
        "items": [
            {
                "severity": r.severity,
                "min_cents": r.min_cents,
                "max_cents": r.max_cents,
                "currency": r.currency,
            }
            for r in rewards
        ],
    }


# =============================================================================
# Owner / admin
# =============================================================================


@admin_router.post("", response_model=ProgramDetailRead, status_code=status.HTTP_201_CREATED)
async def create_program(
    body: ProgramCreate,
    claims: Claims = Depends(get_claims),
    svc: ProgramService = Depends(get_program_service),
) -> ProgramDetailRead:
    program = await svc.create(owner_user_id=claims.user_id, data=body)
    return _to_detail(program)


@admin_router.patch("/{slug}", response_model=ProgramDetailRead)
async def update_program(
    slug: str,
    body: ProgramUpdate,
    claims: Claims = Depends(get_claims),
    svc: ProgramService = Depends(get_program_service),
) -> ProgramDetailRead:
    program = await svc.get_by_slug(slug)
    updated = await svc.update(program.id, actor_id=claims.user_id, data=body)
    return _to_detail(updated)


@admin_router.put("/{slug}/scope")
async def replace_scope(
    slug: str,
    scope: list[ScopeItem],
    claims: Claims = Depends(get_claims),
    svc: ProgramService = Depends(get_program_service),
) -> dict:
    program = await svc.get_by_slug(slug)
    items = await svc.replace_scope(program.id, actor_id=claims.user_id, scope=scope)
    return {
        "items": [
            {
                "asset_type": s.asset_type,
                "asset_identifier": s.asset_identifier,
                "severity_max": s.severity_max,
                "in_scope": s.in_scope,
                "notes": s.notes,
            }
            for s in items
        ]
    }


@admin_router.put("/{slug}/rewards")
async def replace_rewards(
    slug: str,
    rewards: list[RewardTier],
    claims: Claims = Depends(get_claims),
    svc: ProgramService = Depends(get_program_service),
) -> dict:
    program = await svc.get_by_slug(slug)
    items = await svc.replace_rewards(program.id, actor_id=claims.user_id, rewards=rewards)
    return {
        "items": [
            {
                "severity": r.severity,
                "min_cents": r.min_cents,
                "max_cents": r.max_cents,
                "currency": r.currency,
            }
            for r in items
        ]
    }


@admin_router.post("/{slug}/updates", status_code=status.HTTP_201_CREATED)
async def create_program_update(
    slug: str,
    body: ProgramUpdateCreate,
    claims: Claims = Depends(get_claims),
    svc: ProgramService = Depends(get_program_service),
) -> dict:
    """Post an announcement to the program's hackers."""
    program = await svc.get_by_slug(slug)
    if program.owner_user_id != claims.user_id and not claims.is_admin:
        raise AppError(ErrorCode.FORBIDDEN, "only the program owner can post updates")
    await svc.post_update(
        program.id, author_id=claims.user_id, title=body.title, body_md=body.body_md
    )
    return {"status": "created"}


@admin_router.post("/{slug}/publish", response_model=ProgramDetailRead)
async def publish_program(
    slug: str,
    claims: Claims = Depends(get_claims),
    svc: ProgramService = Depends(get_program_service),
    publisher: BountyEventPublisher = Depends(get_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> ProgramDetailRead:
    program = await svc.get_by_slug(slug)
    updated = await svc.transition_status(
        program.id, new_status="published", actor_id=claims.user_id
    )
    await publisher.publish(
        event_type=EventType.PROGRAM_PUBLISHED,
        subject_id=updated.id,
        actor_id=claims.user_id,
        payload={"slug": updated.slug, "name": updated.name},
        request_id=request_id,
    )
    return _to_detail(updated)


@admin_router.post("/{slug}/pause", response_model=ProgramDetailRead)
async def pause_program(
    slug: str,
    claims: Claims = Depends(get_claims),
    svc: ProgramService = Depends(get_program_service),
    publisher: BountyEventPublisher = Depends(get_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> ProgramDetailRead:
    program = await svc.get_by_slug(slug)
    updated = await svc.transition_status(
        program.id, new_status="paused", actor_id=claims.user_id
    )
    await publisher.publish(
        event_type=EventType.PROGRAM_PAUSED,
        subject_id=updated.id,
        actor_id=claims.user_id,
        payload={"slug": updated.slug},
        request_id=request_id,
    )
    return _to_detail(updated)


@admin_router.post("/{slug}/close", response_model=ProgramDetailRead)
async def close_program(
    slug: str,
    claims: Claims = Depends(get_claims),
    svc: ProgramService = Depends(get_program_service),
    publisher: BountyEventPublisher = Depends(get_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> ProgramDetailRead:
    program = await svc.get_by_slug(slug)
    updated = await svc.transition_status(
        program.id, new_status="closed", actor_id=claims.user_id
    )
    await publisher.publish(
        event_type=EventType.PROGRAM_CLOSED,
        subject_id=updated.id,
        actor_id=claims.user_id,
        payload={"slug": updated.slug},
        request_id=request_id,
    )
    return _to_detail(updated)
