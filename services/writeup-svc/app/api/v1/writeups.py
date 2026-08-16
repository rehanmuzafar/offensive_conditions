"""Writeup HTTP endpoints."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, status

from app.api.deps import (
    get_bookmark_service,
    get_claims,
    get_optional_claims,
    get_publisher,
    get_request_id,
    get_vote_service,
    get_writeup_service,
    pagination,
)
from app.core.auth import Claims
from app.core.errors import AppError, ErrorCode
from app.schemas import (
    BookmarkCreate,
    BookmarkRead,
    FeatureToggle,
    PageMeta,
    RejectAction,
    VoteCast,
    VoteResult,
    WriteupCreate,
    WriteupDetailRead,
    WriteupList,
    WriteupOrganizerRead,
    WriteupRead,
    WriteupUpdate,
)
from app.services import (
    BookmarkService,
    EventType,
    VoteService,
    WriteupEventPublisher,
    WriteupService,
)

router = APIRouter(prefix="/writeups", tags=["writeups"])


# =============================================================================
# Read
# =============================================================================


@router.get("", response_model=WriteupList)
async def list_writeups(
    page: tuple[int, int] = Depends(pagination),
    content_type: str | None = Query(None),
    content_id: UUID | None = Query(None),
    language: str | None = Query(None),
    q: str | None = Query(None, min_length=2, max_length=200),
    sort: str = Query("recent", pattern="^(recent|top|featured)$"),
    author_id: UUID | None = Query(None),
    claims: Claims | None = Depends(get_optional_claims),
    svc: WriteupService = Depends(get_writeup_service),
) -> WriteupList:
    limit, offset = page
    items, total = await svc.list_(
        content_type=content_type,
        content_id=content_id,
        language=language,
        search=q,
        sort=sort,
        author_id=author_id,
        viewer_is_moderator=bool(claims and claims.is_moderator),
        limit=limit,
        offset=offset,
    )
    return WriteupList(
        items=[WriteupRead.model_validate(w) for w in items],
        meta=PageMeta(
            total=total, limit=limit, offset=offset, has_more=(offset + limit) < total
        ),
    )


@router.get("/{writeup_id}", response_model=WriteupDetailRead)
async def get_writeup(
    writeup_id: UUID,
    request: Request,
    claims: Claims | None = Depends(get_optional_claims),
    svc: WriteupService = Depends(get_writeup_service),
) -> WriteupDetailRead:
    writeup = await svc.get(writeup_id)
    settings = request.app.state.settings
    await svc.check_read_access(
        writeup,
        viewer_id=claims.user_id if claims else None,
        viewer_is_moderator=bool(claims and claims.is_moderator),
        require_solve=settings.require_solve_to_read,
    )
    # Best-effort view increment
    await svc.increment_view(writeup_id)
    return WriteupDetailRead.model_validate(writeup)


@router.get("/by-slug/{slug}", response_model=WriteupDetailRead)
async def get_writeup_by_slug(
    slug: str,
    request: Request,
    claims: Claims | None = Depends(get_optional_claims),
    svc: WriteupService = Depends(get_writeup_service),
) -> WriteupDetailRead:
    writeup = await svc.get_by_slug(slug)
    settings = request.app.state.settings
    await svc.check_read_access(
        writeup,
        viewer_id=claims.user_id if claims else None,
        viewer_is_moderator=bool(claims and claims.is_moderator),
        require_solve=settings.require_solve_to_read,
    )
    await svc.increment_view(writeup.id)
    return WriteupDetailRead.model_validate(writeup)


# =============================================================================
# Submit + update
# =============================================================================


@router.post("", response_model=WriteupRead, status_code=status.HTTP_201_CREATED)
async def submit_writeup(
    body: WriteupCreate,
    claims: Claims = Depends(get_claims),
    svc: WriteupService = Depends(get_writeup_service),
    publisher: WriteupEventPublisher = Depends(get_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> WriteupRead:
    writeup = await svc.create(author_id=claims.user_id, data=body)
    await publisher.publish(
        event_type=EventType.SUBMITTED,
        subject_id=writeup.id,
        actor_id=claims.user_id,
        payload={
            "content_type": body.content_type,
            "content_id": str(body.content_id),
            "slug": writeup.slug,
            "word_count": writeup.word_count,
        },
        request_id=request_id,
    )
    return WriteupRead.model_validate(writeup)


@router.patch("/{writeup_id}", response_model=WriteupRead)
async def update_writeup(
    writeup_id: UUID,
    body: WriteupUpdate,
    claims: Claims = Depends(get_claims),
    svc: WriteupService = Depends(get_writeup_service),
    publisher: WriteupEventPublisher = Depends(get_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> WriteupRead:
    writeup = await svc.update(
        writeup_id,
        actor_id=claims.user_id,
        is_moderator=claims.is_moderator,
        data=body,
    )
    await publisher.publish(
        event_type=EventType.UPDATED,
        subject_id=writeup_id,
        actor_id=claims.user_id,
        payload={},
        request_id=request_id,
    )
    return WriteupRead.model_validate(writeup)


@router.delete("/{writeup_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_writeup(
    writeup_id: UUID,
    claims: Claims = Depends(get_claims),
    svc: WriteupService = Depends(get_writeup_service),
    publisher: WriteupEventPublisher = Depends(get_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> None:
    await svc.soft_delete(
        writeup_id, actor_id=claims.user_id, is_moderator=claims.is_moderator
    )
    await publisher.publish(
        event_type=EventType.ARCHIVED,
        subject_id=writeup_id,
        actor_id=claims.user_id,
        payload={},
        request_id=request_id,
    )


# =============================================================================
# Moderation
# =============================================================================


@router.post("/{writeup_id}/publish", response_model=WriteupOrganizerRead)
async def publish_writeup(
    writeup_id: UUID,
    claims: Claims = Depends(get_claims),
    svc: WriteupService = Depends(get_writeup_service),
    publisher: WriteupEventPublisher = Depends(get_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> WriteupOrganizerRead:
    if not claims.is_moderator:
        raise AppError(ErrorCode.NOT_MODERATOR, "moderator required")
    writeup = await svc.transition_status(
        writeup_id, new_status="approved", moderator_id=claims.user_id
    )
    await publisher.publish(
        event_type=EventType.APPROVED,
        subject_id=writeup_id,
        actor_id=claims.user_id,
        payload={
            "author_id": str(writeup.author_id),
            "slug": writeup.slug,
        },
        request_id=request_id,
    )
    return WriteupOrganizerRead.model_validate(writeup)


@router.post("/{writeup_id}/reject", response_model=WriteupOrganizerRead)
async def reject_writeup(
    writeup_id: UUID,
    body: RejectAction,
    claims: Claims = Depends(get_claims),
    svc: WriteupService = Depends(get_writeup_service),
    publisher: WriteupEventPublisher = Depends(get_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> WriteupOrganizerRead:
    if not claims.is_moderator:
        raise AppError(ErrorCode.NOT_MODERATOR, "moderator required")
    writeup = await svc.transition_status(
        writeup_id,
        new_status="rejected",
        moderator_id=claims.user_id,
        rejection_reason=body.reason,
    )
    await publisher.publish(
        event_type=EventType.REJECTED,
        subject_id=writeup_id,
        actor_id=claims.user_id,
        payload={"author_id": str(writeup.author_id), "reason": body.reason},
        request_id=request_id,
    )
    return WriteupOrganizerRead.model_validate(writeup)


@router.post("/{writeup_id}/feature", response_model=WriteupOrganizerRead)
async def feature_writeup(
    writeup_id: UUID,
    body: FeatureToggle = FeatureToggle(),
    claims: Claims = Depends(get_claims),
    svc: WriteupService = Depends(get_writeup_service),
    publisher: WriteupEventPublisher = Depends(get_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> WriteupOrganizerRead:
    if not claims.is_moderator:
        raise AppError(ErrorCode.NOT_MODERATOR, "moderator required")
    writeup = await svc.feature(
        writeup_id, featured=body.featured, moderator_id=claims.user_id
    )
    event_type = EventType.FEATURED if body.featured else EventType.UNFEATURED
    await publisher.publish(
        event_type=event_type,
        subject_id=writeup_id,
        actor_id=claims.user_id,
        payload={},
        request_id=request_id,
    )
    return WriteupOrganizerRead.model_validate(writeup)


# =============================================================================
# Votes
# =============================================================================


@router.post("/{writeup_id}/vote", response_model=VoteResult)
async def vote_on_writeup(
    writeup_id: UUID,
    body: VoteCast,
    claims: Claims = Depends(get_claims),
    svc: VoteService = Depends(get_vote_service),
    publisher: WriteupEventPublisher = Depends(get_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> VoteResult:
    result = await svc.cast_writeup_vote(
        writeup_id, voter_id=claims.user_id, direction=body.direction
    )
    await publisher.publish(
        event_type=EventType.VOTE_CAST,
        subject_id=writeup_id,
        actor_id=claims.user_id,
        payload={"direction": body.direction, "score": result["score"]},
        request_id=request_id,
    )
    return VoteResult(**result)


# =============================================================================
# Bookmarks
# =============================================================================


@router.post("/{writeup_id}/bookmark", response_model=BookmarkRead)
async def add_bookmark(
    writeup_id: UUID,
    body: BookmarkCreate = BookmarkCreate(),
    claims: Claims = Depends(get_claims),
    svc: BookmarkService = Depends(get_bookmark_service),
    publisher: WriteupEventPublisher = Depends(get_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> BookmarkRead:
    bm = await svc.add(writeup_id, user_id=claims.user_id, note=body.note)
    await publisher.publish(
        event_type=EventType.BOOKMARK_ADDED,
        subject_id=writeup_id,
        actor_id=claims.user_id,
        payload={},
        request_id=request_id,
    )
    return BookmarkRead.model_validate(bm)


@router.delete("/{writeup_id}/bookmark", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def remove_bookmark(
    writeup_id: UUID,
    claims: Claims = Depends(get_claims),
    svc: BookmarkService = Depends(get_bookmark_service),
    publisher: WriteupEventPublisher = Depends(get_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> None:
    await svc.remove(writeup_id, user_id=claims.user_id)
    await publisher.publish(
        event_type=EventType.BOOKMARK_REMOVED,
        subject_id=writeup_id,
        actor_id=claims.user_id,
        payload={},
        request_id=request_id,
    )
