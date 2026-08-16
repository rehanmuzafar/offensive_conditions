"""Vote, subscription, report, reputation routes."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import (
    get_claims,
    get_publisher,
    get_report_service,
    get_reputation_service,
    get_request_id,
    get_subscription_service,
    get_vote_service,
    pagination,
)
from app.core.auth import Claims
from app.core.errors import AppError, ErrorCode
from app.schemas import (
    PageMeta,
    ReportCreate,
    ReportRead,
    ReportResolve,
    ReputationRead,
    SubscriptionRead,
    SubscriptionToggle,
    VoteCast,
    VoteResult,
)
from app.services import (
    EventType,
    ForumEventPublisher,
    ReportService,
    ReputationService,
    SubscriptionService,
    VoteService,
)

router = APIRouter(tags=["forum"])


# =============================================================================
# Votes
# =============================================================================


@router.post("/posts/{post_id}/vote", response_model=VoteResult)
async def vote_on_post(
    post_id: UUID,
    body: VoteCast,
    claims: Claims = Depends(get_claims),
    svc: VoteService = Depends(get_vote_service),
    publisher: ForumEventPublisher = Depends(get_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> VoteResult:
    result = await svc.cast(post_id, voter_id=claims.user_id, direction=body.direction)
    await publisher.publish(
        event_type=EventType.VOTE_CAST,
        subject_id=post_id,
        actor_id=claims.user_id,
        payload={"direction": body.direction, "score": result["score"]},
        request_id=request_id,
    )
    return VoteResult(**result)


# =============================================================================
# Subscriptions
# =============================================================================


@router.post("/threads/{thread_id}/subscribe", response_model=SubscriptionRead)
async def subscribe_thread(
    thread_id: UUID,
    body: SubscriptionToggle = SubscriptionToggle(),
    claims: Claims = Depends(get_claims),
    svc: SubscriptionService = Depends(get_subscription_service),
) -> SubscriptionRead:
    sub = await svc.subscribe(thread_id, user_id=claims.user_id, prefs=body)
    return SubscriptionRead.model_validate(sub)


@router.delete("/threads/{thread_id}/subscribe", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def unsubscribe_thread(
    thread_id: UUID,
    claims: Claims = Depends(get_claims),
    svc: SubscriptionService = Depends(get_subscription_service),
) -> None:
    await svc.unsubscribe(thread_id, user_id=claims.user_id)


@router.get("/me/subscriptions")
async def my_subscriptions(
    page: tuple[int, int] = Depends(pagination),
    claims: Claims = Depends(get_claims),
    svc: SubscriptionService = Depends(get_subscription_service),
) -> dict:
    limit, offset = page
    items, total = await svc.list_my(claims.user_id, limit=limit, offset=offset)
    return {
        "items": [SubscriptionRead.model_validate(s) for s in items],
        "meta": PageMeta(
            total=total, limit=limit, offset=offset, has_more=(offset + limit) < total
        ),
    }


# =============================================================================
# Reputation
# =============================================================================


@router.get("/users/{user_id}/reputation", response_model=ReputationRead)
async def get_user_reputation(
    user_id: UUID,
    svc: ReputationService = Depends(get_reputation_service),
) -> ReputationRead:
    rep = await svc.get(user_id)
    return ReputationRead.model_validate(rep)


# =============================================================================
# Reports
# =============================================================================


@router.post("/reports", response_model=ReportRead, status_code=status.HTTP_201_CREATED)
async def file_report(
    body: ReportCreate,
    claims: Claims = Depends(get_claims),
    svc: ReportService = Depends(get_report_service),
    publisher: ForumEventPublisher = Depends(get_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> ReportRead:
    report = await svc.file_report(reporter_id=claims.user_id, data=body)
    await publisher.publish(
        event_type=EventType.REPORT_FILED,
        subject_id=report.id,
        actor_id=claims.user_id,
        payload={
            "target_type": body.target_type,
            "target_id": str(body.target_id),
            "reason": body.reason,
        },
        request_id=request_id,
    )
    return ReportRead.model_validate(report)


@router.get("/mod/reports")
async def list_reports(
    page: tuple[int, int] = Depends(pagination),
    status_filter: str | None = Query(None, alias="status"),
    claims: Claims = Depends(get_claims),
    svc: ReportService = Depends(get_report_service),
) -> dict:
    if not claims.is_moderator:
        raise AppError(ErrorCode.NOT_MODERATOR, "moderator required")
    limit, offset = page
    items, total = await svc.list_open(status=status_filter, limit=limit, offset=offset)
    return {
        "items": [ReportRead.model_validate(r) for r in items],
        "meta": PageMeta(
            total=total, limit=limit, offset=offset, has_more=(offset + limit) < total
        ),
    }


@router.post("/mod/reports/{report_id}/resolve", response_model=ReportRead)
async def resolve_report(
    report_id: UUID,
    body: ReportResolve,
    claims: Claims = Depends(get_claims),
    svc: ReportService = Depends(get_report_service),
    publisher: ForumEventPublisher = Depends(get_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> ReportRead:
    if not claims.is_moderator:
        raise AppError(ErrorCode.NOT_MODERATOR, "moderator required")
    report = await svc.resolve(
        report_id, resolver_id=claims.user_id, action=body.action, note=body.note
    )
    await publisher.publish(
        event_type=EventType.REPORT_RESOLVED,
        subject_id=report_id,
        actor_id=claims.user_id,
        payload={"action": body.action},
        request_id=request_id,
    )
    return ReportRead.model_validate(report)
