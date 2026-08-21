"""Report, triage, comment, attachment, payout HTTP endpoints."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import (
    get_attachment_service,
    get_claims,
    get_comment_service,
    get_optional_claims,
    get_payout_service,
    get_program_service,
    get_publisher,
    get_report_service,
    get_request_id,
    pagination,
)
from app.core.auth import Claims
from app.core.errors import AppError, ErrorCode
from app.schemas import (
    AcceptAction,
    AttachmentRead,
    AttachmentUploadRequest,
    AttachmentUploadResponse,
    AwardAction,
    CommentCreate,
    CommentRead,
    DuplicateAction,
    PageMeta,
    PayoutList,
    PayoutRead,
    RejectAction,
    ReportCreate,
    ReportDetailRead,
    ReportList,
    TimelineEntry,
    TimelineList,
    ReportQueueItem,
    HacktivityItem,
    HacktivityList,
    WeaknessRow,
    ReportQueueList,
    AwardRead,
    ReportRead,
    ReportTriagerRead,
    ResolveAction,
)
from app.services import (
    AttachmentService,
    BountyEventPublisher,
    CommentService,
    EventType,
    PayoutService,
    ProgramService,
    ReportService,
)

reports_router = APIRouter(tags=["reports"])
admin_router = APIRouter(prefix="/admin", tags=["reports"])


def _is_triager(claims: Claims) -> bool:
    return claims.is_moderator or "triager" in (claims.roles or [])


# =============================================================================
# Submit + read
# =============================================================================


@reports_router.post(
    "/programs/{slug}/reports",
    response_model=ReportDetailRead,
    status_code=status.HTTP_201_CREATED,
)
async def submit_report(
    slug: str,
    body: ReportCreate,
    claims: Claims = Depends(get_claims),
    programs: ProgramService = Depends(get_program_service),
    reports: ReportService = Depends(get_report_service),
    publisher: BountyEventPublisher = Depends(get_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> ReportDetailRead:
    program = await programs.get_by_slug(slug)
    report = await reports.submit(
        program=program, researcher_id=claims.user_id, data=body
    )
    await publisher.publish(
        event_type=EventType.REPORT_SUBMITTED,
        subject_id=report.id,
        actor_id=claims.user_id,
        payload={
            "short_id": report.short_id,
            "program_id": str(program.id),
            "program_slug": program.slug,
            "severity": report.severity,
        },
        request_id=request_id,
    )
    return ReportDetailRead.model_validate(report)


@reports_router.get("/me/reports", response_model=ReportList)
async def list_my_reports(
    page: tuple[int, int] = Depends(pagination),
    state: str | None = Query(None),
    claims: Claims = Depends(get_claims),
    reports: ReportService = Depends(get_report_service),
) -> ReportList:
    limit, offset = page
    items, total = await reports.list_for_researcher(
        claims.user_id, state=state, limit=limit, offset=offset
    )
    return ReportList(
        items=[ReportRead.model_validate(r) for r in items],
        meta=PageMeta(
            total=total, limit=limit, offset=offset, has_more=(offset + limit) < total
        ),
    )


@reports_router.get("/hacktivity", response_model=HacktivityList)
async def hacktivity(
    page: tuple[int, int] = Depends(pagination),
    program: str | None = Query(None, description="Program slug"),
    severity: str | None = Query(None),
    q: str | None = Query(None, min_length=2, max_length=200),
    reports: ReportService = Depends(get_report_service),
) -> HacktivityList:
    """Disclosed reports. Public — that is what disclosure means."""
    limit, offset = page
    rows, total = await reports.hacktivity(
        program_slug=program, severity=severity, search=q, limit=limit, offset=offset
    )
    return HacktivityList(
        items=[HacktivityItem.model_validate(r) for r in rows],
        meta=PageMeta(
            total=total, limit=limit, offset=offset, has_more=(offset + limit) < total
        ),
    )


@reports_router.get("/hacktivity/weaknesses", response_model=list[WeaknessRow])
async def weakness_index(
    reports: ReportService = Depends(get_report_service),
) -> list[WeaknessRow]:
    """Which weakness classes are actually being found on this platform."""
    return [WeaknessRow(**r) for r in await reports.weakness_index()]


@reports_router.get("/reports/{report_id}", response_model=ReportDetailRead)
async def get_report(
    report_id: UUID,
    claims: Claims = Depends(get_claims),
    reports: ReportService = Depends(get_report_service),
) -> ReportDetailRead:
    report = await reports.get(report_id)
    is_author = report.researcher_id == claims.user_id
    is_triager = _is_triager(claims)
    if not (is_author or is_triager):
        raise AppError(ErrorCode.REPORT_NOT_FOUND, "report not found")
    ctx = await reports.get_context(report_id)
    model = ReportTriagerRead if is_triager else ReportDetailRead
    view = model.model_validate(report)
    view.program_name = ctx.get("program_name")
    view.program_slug = ctx.get("program_slug")
    view.researcher_name = ctx.get("researcher_name")
    view.triager_name = ctx.get("triager_name")
    return view


@reports_router.get("/reports/{report_id}/timeline", response_model=TimelineList)
async def get_report_timeline(
    report_id: UUID,
    claims: Claims = Depends(get_claims),
    reports: ReportService = Depends(get_report_service),
) -> TimelineList:
    """Every state change on the report, oldest first.

    Same visibility rule as the report itself: the researcher who filed it and
    triagers, nobody else.
    """
    report = await reports.get(report_id)
    if not (report.researcher_id == claims.user_id or _is_triager(claims)):
        raise AppError(ErrorCode.REPORT_NOT_FOUND, "report not found")
    return TimelineList(
        items=[TimelineEntry.model_validate(r) for r in await reports.list_timeline(report_id)]
    )


# =============================================================================
# Comments
# =============================================================================


@reports_router.get(
    "/reports/{report_id}/comments", response_model=dict
)
async def list_report_comments(
    report_id: UUID,
    page: tuple[int, int] = Depends(pagination),
    claims: Claims = Depends(get_claims),
    reports: ReportService = Depends(get_report_service),
    comments: CommentService = Depends(get_comment_service),
) -> dict:
    report = await reports.get(report_id)
    is_author = report.researcher_id == claims.user_id
    is_triager = _is_triager(claims)
    if not (is_author or is_triager):
        raise AppError(ErrorCode.REPORT_NOT_FOUND, "report not found")
    limit, offset = page
    items, total = await comments.list_for_report(
        report_id,
        include_internal=is_triager,
        limit=limit,
        offset=offset,
    )
    names = await comments.author_names(items)
    views = []
    for c in items:
        view = CommentRead.model_validate(c)
        view.author_name = names.get(c.author_id)
        views.append(view)
    return {
        "items": views,
        "meta": PageMeta(
            total=total, limit=limit, offset=offset, has_more=(offset + limit) < total
        ),
    }


@reports_router.post(
    "/reports/{report_id}/comments",
    response_model=CommentRead,
    status_code=status.HTTP_201_CREATED,
)
async def add_report_comment(
    report_id: UUID,
    body: CommentCreate,
    claims: Claims = Depends(get_claims),
    reports: ReportService = Depends(get_report_service),
    comments: CommentService = Depends(get_comment_service),
    publisher: BountyEventPublisher = Depends(get_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> CommentRead:
    report = await reports.get(report_id)
    is_author = report.researcher_id == claims.user_id
    is_triager = _is_triager(claims)
    if not (is_author or is_triager):
        raise AppError(ErrorCode.REPORT_NOT_FOUND, "report not found")
    role = "triager" if is_triager else "researcher"
    comment = await comments.add(
        report_id, author_id=claims.user_id, author_role=role, data=body
    )
    await publisher.publish(
        event_type=EventType.REPORT_COMMENT_ADDED,
        subject_id=report_id,
        actor_id=claims.user_id,
        payload={"comment_id": str(comment.id), "visibility": comment.visibility},
        request_id=request_id,
    )
    return CommentRead.model_validate(comment)


# =============================================================================
# Attachments
# =============================================================================


@reports_router.post(
    "/reports/{report_id}/attachments",
    response_model=AttachmentUploadResponse,
    status_code=status.HTTP_201_CREATED,
)
async def request_attachment_upload(
    report_id: UUID,
    body: AttachmentUploadRequest,
    claims: Claims = Depends(get_claims),
    reports: ReportService = Depends(get_report_service),
    attachments: AttachmentService = Depends(get_attachment_service),
) -> AttachmentUploadResponse:
    report = await reports.get(report_id)
    is_author = report.researcher_id == claims.user_id
    is_triager = _is_triager(claims)
    if not (is_author or is_triager):
        raise AppError(ErrorCode.REPORT_NOT_FOUND, "report not found")

    attachment, presigned = await attachments.request_upload(
        report_id,
        uploader_id=claims.user_id,
        is_program_member=is_triager,
        data=body,
    )
    from datetime import datetime, timezone

    return AttachmentUploadResponse(
        attachment_id=attachment.id,
        s3_key=attachment.s3_key,
        presigned_url=presigned["url"],
        presigned_fields=presigned["fields"],
        expires_at=datetime.fromtimestamp(presigned["expires_at"], tz=timezone.utc),
    )


@reports_router.get(
    "/reports/{report_id}/attachments",
    response_model=dict,
)
async def list_attachments(
    report_id: UUID,
    claims: Claims = Depends(get_claims),
    reports: ReportService = Depends(get_report_service),
    attachments: AttachmentService = Depends(get_attachment_service),
) -> dict:
    report = await reports.get(report_id)
    is_author = report.researcher_id == claims.user_id
    is_triager = _is_triager(claims)
    if not (is_author or is_triager):
        raise AppError(ErrorCode.REPORT_NOT_FOUND, "report not found")
    items = await attachments.list_for_report(report_id)
    return {"items": [AttachmentRead.model_validate(a) for a in items]}


@reports_router.get("/attachments/{attachment_id}/download")
async def download_attachment(
    attachment_id: UUID,
    claims: Claims = Depends(get_claims),
    attachments: AttachmentService = Depends(get_attachment_service),
) -> dict:
    is_triager = _is_triager(claims)
    url = await attachments.get_download_url(
        attachment_id, viewer_id=claims.user_id, is_program_member=is_triager
    )
    return {"url": url}


# =============================================================================
# Triage actions (admin/triager only)
# =============================================================================


@admin_router.get("/reports", response_model=ReportQueueList)
async def list_report_queue(
    page: tuple[int, int] = Depends(pagination),
    state: str | None = Query(None),
    severity: str | None = Query(None),
    program: str | None = Query(None, description="Program slug"),
    claims: Claims = Depends(get_claims),
    reports: ReportService = Depends(get_report_service),
) -> ReportQueueList:
    """Every program's reports in one queue, oldest and SLA-breached first.

    The per-program list already existed, but a triager works an inbox, not a
    program at a time — with only the per-program route the admin screen had
    nothing to call and showed nothing.
    """
    if not _is_triager(claims):
        raise AppError(ErrorCode.REPORT_NOT_TRIAGER, "triager role required")
    limit, offset = page
    rows, total = await reports.list_queue(
        state=state, severity=severity, program_slug=program, limit=limit, offset=offset
    )
    return ReportQueueList(
        items=[ReportQueueItem.model_validate(r) for r in rows],
        meta=PageMeta(
            total=total, limit=limit, offset=offset, has_more=(offset + limit) < total
        ),
    )


@admin_router.get("/programs/{slug}/reports", response_model=ReportList)
async def list_program_reports(
    slug: str,
    page: tuple[int, int] = Depends(pagination),
    state: str | None = Query(None),
    severity: str | None = Query(None),
    claims: Claims = Depends(get_claims),
    programs: ProgramService = Depends(get_program_service),
    reports: ReportService = Depends(get_report_service),
) -> ReportList:
    if not _is_triager(claims):
        raise AppError(ErrorCode.REPORT_NOT_TRIAGER, "triager role required")
    program = await programs.get_by_slug(slug)
    limit, offset = page
    items, total = await reports.list_for_program(
        program.id, state=state, severity=severity, limit=limit, offset=offset
    )
    return ReportList(
        items=[ReportRead.model_validate(r) for r in items],
        meta=PageMeta(
            total=total, limit=limit, offset=offset, has_more=(offset + limit) < total
        ),
    )


@admin_router.post("/reports/{report_id}/triage", response_model=ReportTriagerRead)
async def start_triage(
    report_id: UUID,
    claims: Claims = Depends(get_claims),
    reports: ReportService = Depends(get_report_service),
    publisher: BountyEventPublisher = Depends(get_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> ReportTriagerRead:
    if not _is_triager(claims):
        raise AppError(ErrorCode.REPORT_NOT_TRIAGER, "triager role required")
    report = await reports.start_triage(report_id, triager_id=claims.user_id)
    await publisher.publish(
        event_type=EventType.REPORT_TRIAGED,
        subject_id=report.id,
        actor_id=claims.user_id,
        payload={"researcher_id": str(report.researcher_id)},
        request_id=request_id,
    )
    return ReportTriagerRead.model_validate(report)


@admin_router.post("/reports/{report_id}/accept", response_model=ReportTriagerRead)
async def accept_report(
    report_id: UUID,
    body: AcceptAction,
    claims: Claims = Depends(get_claims),
    reports: ReportService = Depends(get_report_service),
    publisher: BountyEventPublisher = Depends(get_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> ReportTriagerRead:
    if not _is_triager(claims):
        raise AppError(ErrorCode.REPORT_NOT_TRIAGER, "triager role required")
    report = await reports.accept(report_id, triager_id=claims.user_id, action=body)
    await publisher.publish(
        event_type=EventType.REPORT_ACCEPTED,
        subject_id=report.id,
        actor_id=claims.user_id,
        payload={
            "researcher_id": str(report.researcher_id),
            "severity": report.severity,
            "cvss_score": float(report.cvss_score) if report.cvss_score else None,
        },
        request_id=request_id,
    )
    return ReportTriagerRead.model_validate(report)


@admin_router.post("/reports/{report_id}/reject", response_model=ReportTriagerRead)
async def reject_report(
    report_id: UUID,
    body: RejectAction,
    claims: Claims = Depends(get_claims),
    reports: ReportService = Depends(get_report_service),
    publisher: BountyEventPublisher = Depends(get_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> ReportTriagerRead:
    if not _is_triager(claims):
        raise AppError(ErrorCode.REPORT_NOT_TRIAGER, "triager role required")
    report = await reports.reject(report_id, triager_id=claims.user_id, action=body)
    await publisher.publish(
        event_type=EventType.REPORT_REJECTED,
        subject_id=report.id,
        actor_id=claims.user_id,
        payload={"researcher_id": str(report.researcher_id), "reason": body.reason},
        request_id=request_id,
    )
    return ReportTriagerRead.model_validate(report)


@admin_router.post("/reports/{report_id}/duplicate", response_model=ReportTriagerRead)
async def mark_duplicate(
    report_id: UUID,
    body: DuplicateAction,
    claims: Claims = Depends(get_claims),
    reports: ReportService = Depends(get_report_service),
    publisher: BountyEventPublisher = Depends(get_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> ReportTriagerRead:
    if not _is_triager(claims):
        raise AppError(ErrorCode.REPORT_NOT_TRIAGER, "triager role required")
    report = await reports.mark_duplicate(
        report_id, triager_id=claims.user_id, action=body
    )
    await publisher.publish(
        event_type=EventType.REPORT_DUPLICATE,
        subject_id=report.id,
        actor_id=claims.user_id,
        payload={
            "researcher_id": str(report.researcher_id),
            "duplicate_of_id": str(body.duplicate_of_id),
        },
        request_id=request_id,
    )
    return ReportTriagerRead.model_validate(report)


@admin_router.post("/reports/{report_id}/resolve", response_model=ReportTriagerRead)
async def resolve_report(
    report_id: UUID,
    body: ResolveAction,
    claims: Claims = Depends(get_claims),
    reports: ReportService = Depends(get_report_service),
    publisher: BountyEventPublisher = Depends(get_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> ReportTriagerRead:
    if not _is_triager(claims):
        raise AppError(ErrorCode.REPORT_NOT_TRIAGER, "triager role required")
    report = await reports.resolve(report_id, triager_id=claims.user_id, action=body)
    await publisher.publish(
        event_type=EventType.REPORT_RESOLVED,
        subject_id=report.id,
        actor_id=claims.user_id,
        payload={"researcher_id": str(report.researcher_id)},
        request_id=request_id,
    )
    return ReportTriagerRead.model_validate(report)


@admin_router.post("/reports/{report_id}/award", response_model=AwardRead)
async def award_bounty(
    report_id: UUID,
    body: AwardAction,
    claims: Claims = Depends(get_claims),
    reports: ReportService = Depends(get_report_service),
    payouts: PayoutService = Depends(get_payout_service),
    publisher: BountyEventPublisher = Depends(get_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> AwardRead:
    if not _is_triager(claims):
        raise AppError(ErrorCode.REPORT_NOT_TRIAGER, "triager role required")

    report = await reports.set_bounty_amount(
        report_id, action=body, actor_id=claims.user_id
    )
    await publisher.publish(
        event_type=EventType.REPORT_AWARDED,
        subject_id=report.id,
        actor_id=claims.user_id,
        payload={
            "researcher_id": str(report.researcher_id),
            "amount_cents": body.amount_cents,
            "currency": body.currency,
        },
        request_id=request_id,
    )

    if not body.initiate_payout:
        # The award itself is already done and published above. Raising here —
        # which is what this used to do — told the caller it had failed while
        # the amount was on the report and the event was on the bus, so the UI
        # showed an error for a state change that had actually happened.
        return AwardRead(
            report_id=report.id,
            amount_cents=report.bounty_cents,
            currency=report.bounty_currency or body.currency,
            payout=None,
        )

    payout = await payouts.request_payout(report=report, actor_id=claims.user_id)
    await publisher.publish(
        event_type=EventType.PAYOUT_REQUESTED,
        subject_id=payout.id,
        actor_id=claims.user_id,
        payload={
            "report_id": str(report.id),
            "researcher_id": str(report.researcher_id),
            "amount_cents": payout.amount_cents,
            "currency": payout.currency,
        },
        request_id=request_id,
    )
    return AwardRead(
        report_id=report.id,
        amount_cents=report.bounty_cents,
        currency=report.bounty_currency or body.currency,
        payout=PayoutRead.model_validate(payout),
    )


# =============================================================================
# Payouts
# =============================================================================


@reports_router.get("/me/payouts", response_model=PayoutList)
async def list_my_payouts(
    page: tuple[int, int] = Depends(pagination),
    claims: Claims = Depends(get_claims),
    payouts: PayoutService = Depends(get_payout_service),
) -> PayoutList:
    limit, offset = page
    items, total = await payouts.list_for_researcher(
        claims.user_id, limit=limit, offset=offset
    )
    labels = await payouts.report_labels(items)
    views = []
    for p in items:
        view = PayoutRead.model_validate(p)
        short_id, program_name = labels.get(p.report_id, (None, None))
        view.report_short_id = short_id
        view.program_name = program_name
        views.append(view)
    return PayoutList(
        items=views,
        meta=PageMeta(
            total=total, limit=limit, offset=offset, has_more=(offset + limit) < total
        ),
    )
