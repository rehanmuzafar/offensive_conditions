"""Comment, moderation, and personal endpoints."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import (
    get_bookmark_service,
    get_claims,
    get_comment_service,
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
    BookmarkRead,
    CommentCreate,
    CommentList,
    CommentRead,
    CommentUpdate,
    PageMeta,
    VoteCast,
    VoteResult,
    WriteupList,
    WriteupOrganizerRead,
    WriteupRead,
)
from app.services import (
    BookmarkService,
    CommentService,
    EventType,
    VoteService,
    WriteupEventPublisher,
    WriteupService,
)

router = APIRouter(tags=["writeups"])


# =============================================================================
# Comments
# =============================================================================


@router.get("/writeups/{writeup_id}/comments", response_model=CommentList)
async def list_comments(
    writeup_id: UUID,
    page: tuple[int, int] = Depends(pagination),
    claims: Claims | None = Depends(get_optional_claims),
    svc: CommentService = Depends(get_comment_service),
) -> CommentList:
    limit, offset = page
    include_deleted = bool(claims and claims.is_moderator)
    items, total = await svc.list_for_writeup(
        writeup_id, limit=limit, offset=offset, include_deleted=include_deleted
    )
    return CommentList(
        items=[CommentRead.model_validate(c) for c in items],
        meta=PageMeta(
            total=total, limit=limit, offset=offset, has_more=(offset + limit) < total
        ),
    )


@router.post(
    "/writeups/{writeup_id}/comments",
    response_model=CommentRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_comment(
    writeup_id: UUID,
    body: CommentCreate,
    claims: Claims = Depends(get_claims),
    svc: CommentService = Depends(get_comment_service),
    publisher: WriteupEventPublisher = Depends(get_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> CommentRead:
    comment = await svc.create(writeup_id, author_id=claims.user_id, data=body)
    await publisher.publish(
        event_type=EventType.COMMENT_CREATED,
        subject_id=comment.id,
        actor_id=claims.user_id,
        payload={
            "writeup_id": str(writeup_id),
            "parent_comment_id": (
                str(comment.parent_comment_id) if comment.parent_comment_id else None
            ),
        },
        request_id=request_id,
    )
    return CommentRead.model_validate(comment)


@router.patch("/comments/{comment_id}", response_model=CommentRead)
async def update_comment(
    comment_id: UUID,
    body: CommentUpdate,
    claims: Claims = Depends(get_claims),
    svc: CommentService = Depends(get_comment_service),
    publisher: WriteupEventPublisher = Depends(get_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> CommentRead:
    comment = await svc.update(
        comment_id,
        actor_id=claims.user_id,
        is_moderator=claims.is_moderator,
        data=body,
    )
    await publisher.publish(
        event_type=EventType.COMMENT_EDITED,
        subject_id=comment_id,
        actor_id=claims.user_id,
        payload={},
        request_id=request_id,
    )
    return CommentRead.model_validate(comment)


@router.delete("/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_comment(
    comment_id: UUID,
    claims: Claims = Depends(get_claims),
    svc: CommentService = Depends(get_comment_service),
    publisher: WriteupEventPublisher = Depends(get_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> None:
    await svc.soft_delete(
        comment_id, actor_id=claims.user_id, is_moderator=claims.is_moderator
    )
    await publisher.publish(
        event_type=EventType.COMMENT_DELETED,
        subject_id=comment_id,
        actor_id=claims.user_id,
        payload={},
        request_id=request_id,
    )


@router.post("/comments/{comment_id}/vote", response_model=VoteResult)
async def vote_on_comment(
    comment_id: UUID,
    body: VoteCast,
    claims: Claims = Depends(get_claims),
    svc: VoteService = Depends(get_vote_service),
    publisher: WriteupEventPublisher = Depends(get_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> VoteResult:
    result = await svc.cast_comment_vote(
        comment_id, voter_id=claims.user_id, direction=body.direction
    )
    await publisher.publish(
        event_type=EventType.COMMENT_VOTE_CAST,
        subject_id=comment_id,
        actor_id=claims.user_id,
        payload={"direction": body.direction, "score": result["score"]},
        request_id=request_id,
    )
    return VoteResult(**result)


# =============================================================================
# Moderation queue
# =============================================================================


@router.get("/mod/writeups/pending", response_model=WriteupList)
async def list_pending_writeups(
    page: tuple[int, int] = Depends(pagination),
    claims: Claims = Depends(get_claims),
    svc: WriteupService = Depends(get_writeup_service),
) -> WriteupList:
    if not claims.is_moderator:
        raise AppError(ErrorCode.NOT_MODERATOR, "moderator required")
    limit, offset = page
    items, total = await svc.list_(
        status="pending",
        viewer_is_moderator=True,
        sort="recent",
        limit=limit,
        offset=offset,
    )
    return WriteupList(
        items=[WriteupRead.model_validate(w) for w in items],
        meta=PageMeta(
            total=total, limit=limit, offset=offset, has_more=(offset + limit) < total
        ),
    )


@router.get("/mod/writeups/rejected", response_model=WriteupList)
async def list_rejected_writeups(
    page: tuple[int, int] = Depends(pagination),
    claims: Claims = Depends(get_claims),
    svc: WriteupService = Depends(get_writeup_service),
) -> WriteupList:
    if not claims.is_moderator:
        raise AppError(ErrorCode.NOT_MODERATOR, "moderator required")
    limit, offset = page
    items, total = await svc.list_(
        status="rejected",
        viewer_is_moderator=True,
        sort="recent",
        limit=limit,
        offset=offset,
    )
    return WriteupList(
        items=[WriteupRead.model_validate(w) for w in items],
        meta=PageMeta(
            total=total, limit=limit, offset=offset, has_more=(offset + limit) < total
        ),
    )


# =============================================================================
# Personal endpoints
# =============================================================================


@router.get("/me/bookmarks")
async def my_bookmarks(
    page: tuple[int, int] = Depends(pagination),
    claims: Claims = Depends(get_claims),
    svc: BookmarkService = Depends(get_bookmark_service),
) -> dict:
    limit, offset = page
    items, total = await svc.list_my(claims.user_id, limit=limit, offset=offset)
    return {
        "items": [BookmarkRead.model_validate(b) for b in items],
        "meta": PageMeta(
            total=total, limit=limit, offset=offset, has_more=(offset + limit) < total
        ),
    }
