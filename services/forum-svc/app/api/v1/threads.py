"""Thread + post HTTP endpoints."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    get_claims,
    get_optional_claims,
    get_post_service,
    get_publisher,
    get_request_id,
    get_subscription_service,
    get_thread_service,
    pagination,
)
from app.core.auth import Claims
from app.core.errors import AppError, ErrorCode
from app.db.session import get_session
from app.models import Category
from app.schemas import (
    CategoryRead,
    PageMeta,
    PostCreate,
    PostList,
    PostRead,
    PostUpdate,
    SubscriptionRead,
    SubscriptionToggle,
    ThreadCreate,
    ThreadList,
    ThreadRead,
    ThreadUpdate,
)
from app.services import (
    EventType,
    ForumEventPublisher,
    PostService,
    SubscriptionService,
    ThreadService,
)

router = APIRouter(tags=["forum"])


# =============================================================================
# Categories
# =============================================================================


@router.get("/categories", response_model=list[CategoryRead])
async def list_categories(
    session: AsyncSession = Depends(get_session),
) -> list[CategoryRead]:
    result = await session.execute(
        select(Category).order_by(Category.sort_order.asc(), Category.name.asc())
    )
    return [CategoryRead.model_validate(c) for c in result.scalars().all()]


# =============================================================================
# Threads
# =============================================================================


@router.get("/threads", response_model=ThreadList)
async def list_threads(
    page: tuple[int, int] = Depends(pagination),
    category_id: UUID | None = Query(None),
    tag: str | None = Query(None),
    q: str | None = Query(None, min_length=2, max_length=200),
    status_filter: str | None = Query(None, alias="status"),
    sort: str = Query("recent", pattern="^(recent|hot|top)$"),
    claims: Claims | None = Depends(get_optional_claims),
    svc: ThreadService = Depends(get_thread_service),
) -> ThreadList:
    limit, offset = page
    items, total = await svc.list_(
        category_id=category_id,
        tag=tag,
        search=q,
        status=status_filter,
        viewer_tier=claims.tier if claims else "free",
        sort=sort,
        limit=limit,
        offset=offset,
    )
    return ThreadList(
        items=[ThreadRead.model_validate(t) for t in items],
        meta=PageMeta(
            total=total, limit=limit, offset=offset, has_more=(offset + limit) < total
        ),
    )


@router.get("/threads/{thread_id}", response_model=ThreadRead)
async def get_thread(
    thread_id: UUID,
    svc: ThreadService = Depends(get_thread_service),
) -> ThreadRead:
    thread = await svc.get(thread_id)
    # Best-effort view increment
    await svc.increment_view(thread_id)
    return ThreadRead.model_validate(thread)


@router.get("/threads/by-slug/{slug}", response_model=ThreadRead)
async def get_thread_by_slug(
    slug: str,
    svc: ThreadService = Depends(get_thread_service),
) -> ThreadRead:
    thread = await svc.get_by_slug(slug)
    await svc.increment_view(thread.id)
    return ThreadRead.model_validate(thread)


@router.post("/threads", response_model=ThreadRead, status_code=status.HTTP_201_CREATED)
async def create_thread(
    body: ThreadCreate,
    claims: Claims = Depends(get_claims),
    svc: ThreadService = Depends(get_thread_service),
    sub_svc: SubscriptionService = Depends(get_subscription_service),
    publisher: ForumEventPublisher = Depends(get_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> ThreadRead:
    thread, first_post = await svc.create(author_id=claims.user_id, data=body)

    # Auto-subscribe author
    await sub_svc.subscribe(
        thread.id,
        user_id=claims.user_id,
        prefs=SubscriptionToggle(),
    )

    await publisher.publish(
        event_type=EventType.THREAD_CREATED,
        subject_id=thread.id,
        actor_id=claims.user_id,
        payload={
            "slug": thread.slug,
            "title": thread.title,
            "category_id": str(thread.category_id),
            "first_post_id": str(first_post.id),
        },
        request_id=request_id,
    )
    return ThreadRead.model_validate(thread)


@router.patch("/threads/{thread_id}", response_model=ThreadRead)
async def update_thread(
    thread_id: UUID,
    body: ThreadUpdate,
    claims: Claims = Depends(get_claims),
    svc: ThreadService = Depends(get_thread_service),
) -> ThreadRead:
    thread = await svc.update(
        thread_id,
        actor_id=claims.user_id,
        is_moderator=claims.is_moderator,
        data=body,
    )
    return ThreadRead.model_validate(thread)


@router.post("/threads/{thread_id}/lock", response_model=ThreadRead)
async def lock_thread(
    thread_id: UUID,
    claims: Claims = Depends(get_claims),
    svc: ThreadService = Depends(get_thread_service),
    publisher: ForumEventPublisher = Depends(get_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> ThreadRead:
    thread = await svc.set_status(
        thread_id,
        new_status="locked",
        actor_id=claims.user_id,
        is_moderator=claims.is_moderator,
    )
    await publisher.publish(
        event_type=EventType.THREAD_LOCKED,
        subject_id=thread_id,
        actor_id=claims.user_id,
        payload={"slug": thread.slug},
        request_id=request_id,
    )
    return ThreadRead.model_validate(thread)


@router.post("/threads/{thread_id}/unlock", response_model=ThreadRead)
async def unlock_thread(
    thread_id: UUID,
    claims: Claims = Depends(get_claims),
    svc: ThreadService = Depends(get_thread_service),
) -> ThreadRead:
    thread = await svc.set_status(
        thread_id,
        new_status="open",
        actor_id=claims.user_id,
        is_moderator=claims.is_moderator,
    )
    return ThreadRead.model_validate(thread)


@router.post("/threads/{thread_id}/pin", response_model=ThreadRead)
async def pin_thread(
    thread_id: UUID,
    claims: Claims = Depends(get_claims),
    svc: ThreadService = Depends(get_thread_service),
) -> ThreadRead:
    thread = await svc.set_pinned(thread_id, pinned=True, is_moderator=claims.is_moderator)
    return ThreadRead.model_validate(thread)


@router.post("/threads/{thread_id}/unpin", response_model=ThreadRead)
async def unpin_thread(
    thread_id: UUID,
    claims: Claims = Depends(get_claims),
    svc: ThreadService = Depends(get_thread_service),
) -> ThreadRead:
    thread = await svc.set_pinned(thread_id, pinned=False, is_moderator=claims.is_moderator)
    return ThreadRead.model_validate(thread)


@router.post("/threads/{thread_id}/solve", response_model=ThreadRead)
async def mark_solved(
    thread_id: UUID,
    solved_post_id: UUID = Query(...),
    claims: Claims = Depends(get_claims),
    svc: ThreadService = Depends(get_thread_service),
    publisher: ForumEventPublisher = Depends(get_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> ThreadRead:
    thread = await svc.mark_solved(
        thread_id,
        solved_post_id=solved_post_id,
        actor_id=claims.user_id,
        is_moderator=claims.is_moderator,
    )
    await publisher.publish(
        event_type=EventType.THREAD_SOLVED,
        subject_id=thread_id,
        actor_id=claims.user_id,
        payload={"solved_post_id": str(solved_post_id)},
        request_id=request_id,
    )
    return ThreadRead.model_validate(thread)


@router.post("/threads/{thread_id}/unsolve", response_model=ThreadRead)
async def unsolve(
    thread_id: UUID,
    claims: Claims = Depends(get_claims),
    svc: ThreadService = Depends(get_thread_service),
) -> ThreadRead:
    thread = await svc.mark_solved(
        thread_id,
        solved_post_id=None,
        actor_id=claims.user_id,
        is_moderator=claims.is_moderator,
    )
    return ThreadRead.model_validate(thread)


@router.delete("/threads/{thread_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_thread(
    thread_id: UUID,
    claims: Claims = Depends(get_claims),
    svc: ThreadService = Depends(get_thread_service),
    publisher: ForumEventPublisher = Depends(get_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> None:
    await svc.soft_delete(
        thread_id, actor_id=claims.user_id, is_moderator=claims.is_moderator
    )
    await publisher.publish(
        event_type=EventType.THREAD_DELETED,
        subject_id=thread_id,
        actor_id=claims.user_id,
        payload={},
        request_id=request_id,
    )


# =============================================================================
# Posts
# =============================================================================


@router.get("/threads/{thread_id}/posts", response_model=PostList)
async def list_posts(
    thread_id: UUID,
    page: tuple[int, int] = Depends(pagination),
    claims: Claims | None = Depends(get_optional_claims),
    svc: PostService = Depends(get_post_service),
) -> PostList:
    limit, offset = page
    include_deleted = bool(claims and claims.is_moderator)
    items, total = await svc.list_for_thread(
        thread_id, limit=limit, offset=offset, include_deleted=include_deleted
    )
    return PostList(
        items=[PostRead.model_validate(p) for p in items],
        meta=PageMeta(
            total=total, limit=limit, offset=offset, has_more=(offset + limit) < total
        ),
    )


@router.post("/threads/{thread_id}/posts", response_model=PostRead, status_code=status.HTTP_201_CREATED)
async def create_post(
    thread_id: UUID,
    body: PostCreate,
    claims: Claims = Depends(get_claims),
    svc: PostService = Depends(get_post_service),
    sub_svc: SubscriptionService = Depends(get_subscription_service),
    publisher: ForumEventPublisher = Depends(get_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> PostRead:
    post = await svc.create_reply(thread_id, author_id=claims.user_id, data=body)

    # Auto-subscribe replier
    try:
        await sub_svc.subscribe(thread_id, user_id=claims.user_id, prefs=SubscriptionToggle())
    except AppError as e:
        if e.code != ErrorCode.ALREADY_SUBSCRIBED:
            raise

    await publisher.publish(
        event_type=EventType.POST_CREATED,
        subject_id=post.id,
        actor_id=claims.user_id,
        payload={
            "thread_id": str(thread_id),
            "parent_post_id": str(post.parent_post_id) if post.parent_post_id else None,
        },
        request_id=request_id,
    )
    return PostRead.model_validate(post)


@router.patch("/posts/{post_id}", response_model=PostRead)
async def update_post(
    post_id: UUID,
    body: PostUpdate,
    claims: Claims = Depends(get_claims),
    svc: PostService = Depends(get_post_service),
    publisher: ForumEventPublisher = Depends(get_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> PostRead:
    post = await svc.update(
        post_id,
        actor_id=claims.user_id,
        is_moderator=claims.is_moderator,
        data=body,
    )
    await publisher.publish(
        event_type=EventType.POST_EDITED,
        subject_id=post_id,
        actor_id=claims.user_id,
        payload={},
        request_id=request_id,
    )
    return PostRead.model_validate(post)


@router.delete("/posts/{post_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_post(
    post_id: UUID,
    claims: Claims = Depends(get_claims),
    svc: PostService = Depends(get_post_service),
    publisher: ForumEventPublisher = Depends(get_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> None:
    await svc.soft_delete(
        post_id, actor_id=claims.user_id, is_moderator=claims.is_moderator
    )
    await publisher.publish(
        event_type=EventType.POST_DELETED,
        subject_id=post_id,
        actor_id=claims.user_id,
        payload={},
        request_id=request_id,
    )
