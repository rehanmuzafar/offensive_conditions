"""Event HTTP endpoints."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Response, status

from app.api.deps import (
    get_announcement_service,
    get_claims,
    get_event_service,
    get_optional_claims,
    get_publisher,
    get_registration_service,
    get_request_id,
    get_ws_broker,
    pagination,
)
from app.core.auth import Claims
from app.core.config import get_settings
from app.services.user_client import UserServiceClient
from app.core.errors import AppError, ErrorCode
from app.schemas import (
    AnnouncementCreate,
    AnnouncementRead,
    DisqualifyRequest,
    EventCreate,
    EventList,
    EventRead,
    EventUpdate,
    LeaderboardResponse,
    PageMeta,
    ParticipantRead,
    SoloRegistration,
    TeamRegistration,
)
from app.services import (
    AnnouncementService,
    CtfEventPublisher,
    EventService,
    EventType,
    RegistrationService,
)
from app.ws import WebSocketBroker

router = APIRouter(prefix="/events", tags=["events"])


# =============================================================================
# Event CRUD
# =============================================================================


@router.get("", response_model=EventList)
async def list_events(
    page: tuple[int, int] = Depends(pagination),
    status_filter: str | None = Query(None, alias="status"),
    format: str | None = Query(None),
    visibility: str | None = Query(None),
    claims: Claims | None = Depends(get_optional_claims),
    svc: EventService = Depends(get_event_service),
) -> EventList:
    limit, offset = page
    items, total = await svc.list_(
        viewer_tier=claims.tier if claims else "free",
        status=status_filter,
        format_=format,
        visibility=visibility,
        viewer_is_organizer=bool(claims and claims.is_ctf_organizer),
        limit=limit,
        offset=offset,
    )
    return EventList(
        items=[EventRead.model_validate(e) for e in items],
        meta=PageMeta(
            total=total, limit=limit, offset=offset, has_more=(offset + limit) < total
        ),
    )


@router.get("/{event_id}", response_model=EventRead)
async def get_event(
    event_id: UUID,
    svc: EventService = Depends(get_event_service),
) -> EventRead:
    event = await svc.get(event_id)
    return EventRead.model_validate(event)


@router.get("/by-slug/{slug}", response_model=EventRead)
async def get_event_by_slug(
    slug: str, svc: EventService = Depends(get_event_service)
) -> EventRead:
    event = await svc.get_by_slug(slug)
    return EventRead.model_validate(event)


@router.post("", response_model=EventRead, status_code=status.HTTP_201_CREATED)
async def create_event(
    body: EventCreate,
    claims: Claims = Depends(get_claims),
    svc: EventService = Depends(get_event_service),
    publisher: CtfEventPublisher = Depends(get_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> EventRead:
    if not claims.is_ctf_organizer:
        raise AppError(ErrorCode.NOT_ORGANIZER, "ctf_organizer role required")
    event = await svc.create(creator_id=claims.user_id, data=body)
    return EventRead.model_validate(event)


@router.patch("/{event_id}", response_model=EventRead)
async def update_event(
    event_id: UUID,
    body: EventUpdate,
    claims: Claims = Depends(get_claims),
    svc: EventService = Depends(get_event_service),
) -> EventRead:
    event = await svc.update(
        event_id, actor_id=claims.user_id, is_organizer=claims.is_ctf_organizer, data=body
    )
    return EventRead.model_validate(event)


# =============================================================================
# Lifecycle
# =============================================================================


@router.post("/{event_id}/publish", response_model=EventRead)
async def publish_event(
    event_id: UUID,
    claims: Claims = Depends(get_claims),
    svc: EventService = Depends(get_event_service),
    publisher: CtfEventPublisher = Depends(get_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> EventRead:
    event = await svc.transition_status(
        event_id,
        new_status="published",
        actor_id=claims.user_id,
        is_organizer=claims.is_ctf_organizer,
    )
    await publisher.publish(
        event_type=EventType.EVENT_PUBLISHED,
        subject_id=event_id,
        actor_id=claims.user_id,
        payload={"slug": event.slug, "starts_at": event.starts_at.isoformat()},
        request_id=request_id,
    )
    return EventRead.model_validate(event)


@router.post("/{event_id}/start", response_model=EventRead)
async def start_event(
    event_id: UUID,
    claims: Claims = Depends(get_claims),
    svc: EventService = Depends(get_event_service),
    publisher: CtfEventPublisher = Depends(get_publisher),
    broker: WebSocketBroker = Depends(get_ws_broker),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> EventRead:
    event = await svc.transition_status(
        event_id,
        new_status="live",
        actor_id=claims.user_id,
        is_organizer=claims.is_ctf_organizer,
    )
    await publisher.publish(
        event_type=EventType.EVENT_STARTED,
        subject_id=event_id,
        actor_id=claims.user_id,
        payload={"slug": event.slug},
        request_id=request_id,
    )
    await broker.broadcast(event_id, {"type": "event.started", "event_id": str(event_id)})
    return EventRead.model_validate(event)


@router.post("/{event_id}/end", response_model=EventRead)
async def end_event(
    event_id: UUID,
    claims: Claims = Depends(get_claims),
    svc: EventService = Depends(get_event_service),
    publisher: CtfEventPublisher = Depends(get_publisher),
    broker: WebSocketBroker = Depends(get_ws_broker),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> EventRead:
    event = await svc.transition_status(
        event_id,
        new_status="ended",
        actor_id=claims.user_id,
        is_organizer=claims.is_ctf_organizer,
    )
    await publisher.publish(
        event_type=EventType.EVENT_ENDED,
        subject_id=event_id,
        actor_id=claims.user_id,
        payload={"slug": event.slug},
        request_id=request_id,
    )
    await broker.broadcast(event_id, {"type": "event.ended", "event_id": str(event_id)})
    return EventRead.model_validate(event)


# =============================================================================
# Registration
# =============================================================================


@router.post("/{event_id}/register", response_model=ParticipantRead)
async def register_solo(
    event_id: UUID,
    # Optional: a public event needs no payload, and requiring one made the
    # browser's bodyless POST fail with "request validation failed".
    body: SoloRegistration | None = None,
    # Forwarded to user-svc so it applies its own authorisation when we check
    # the caller really belongs to the team they named.
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
    claims: Claims = Depends(get_claims),
    reg: RegistrationService = Depends(get_registration_service),
    publisher: CtfEventPublisher = Depends(get_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> ParticipantRead:
    # A player may only enter under a team they actually belong to — otherwise
    # anyone could add themselves to another squad's roster mid-event.
    team_id = body.team_id if body else None
    team_name = None
    if team_id is not None:
        team_name, _ = await UserServiceClient(get_settings()).get_team_for_membership(
            team_id, bearer=authorization or "", actor_id=claims.user_id
        )

    p = await reg.register_solo(
        event_id,
        user_id=claims.user_id,
        invitation_code=body.invitation_code if body else None,
        display_name=claims.username or None,
        team_id=team_id,
        team_name=team_name,
    )
    await publisher.publish(
        event_type=EventType.REGISTRATION_CREATED,
        subject_id=event_id,
        actor_id=claims.user_id,
        payload={"participant_id": str(p.id), "type": "user"},
        request_id=request_id,
    )
    return ParticipantRead.model_validate(p)


@router.post("/{event_id}/register-team", response_model=ParticipantRead)
async def register_team(
    event_id: UUID,
    body: TeamRegistration,
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
    claims: Claims = Depends(get_claims),
    reg: RegistrationService = Depends(get_registration_service),
    publisher: CtfEventPublisher = Depends(get_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> ParticipantRead:
    # Verify with user-svc rather than trusting the client: it confirms the
    # caller captains this team and returns the real name and member count.
    # Without this anyone could register anyone else's team, and the hard-coded
    # member_count made max_team_size unenforceable.
    team_name, member_count = await UserServiceClient(
        get_settings()
    ).get_team_for_registration(
        body.team_id, bearer=authorization or "", actor_id=claims.user_id
    )

    p = await reg.register_team(
        event_id,
        captain_id=claims.user_id,
        team_id=body.team_id,
        team_name=team_name,
        member_count=member_count,
        invitation_code=body.invitation_code,
    )
    await publisher.publish(
        event_type=EventType.REGISTRATION_CREATED,
        subject_id=event_id,
        actor_id=claims.user_id,
        payload={"participant_id": str(p.id), "type": "team", "team_id": str(body.team_id)},
        request_id=request_id,
    )
    return ParticipantRead.model_validate(p)


@router.delete("/{event_id}/registration", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def unregister(
    event_id: UUID,
    claims: Claims = Depends(get_claims),
    reg: RegistrationService = Depends(get_registration_service),
    publisher: CtfEventPublisher = Depends(get_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> None:
    await reg.unregister(event_id, user_id=claims.user_id)
    await publisher.publish(
        event_type=EventType.REGISTRATION_REMOVED,
        subject_id=event_id,
        actor_id=claims.user_id,
        payload={},
        request_id=request_id,
    )


@router.get("/{event_id}/participants")
async def list_participants(
    event_id: UUID,
    page: tuple[int, int] = Depends(pagination),
    reg: RegistrationService = Depends(get_registration_service),
) -> dict:
    limit, offset = page
    items, total = await reg.list_participants(event_id, limit=limit, offset=offset)
    return {
        "items": [ParticipantRead.model_validate(p) for p in items],
        "meta": PageMeta(
            total=total, limit=limit, offset=offset, has_more=(offset + limit) < total
        ),
    }


@router.delete("/{event_id}", status_code=204)
async def delete_event(
    event_id: UUID,
    claims: Claims = Depends(get_claims),
    svc: EventService = Depends(get_event_service),
) -> Response:
    """Delete an event and everything hanging off it.

    Organiser-only. Cascades to challenges, participants, progress, chat and
    solves — there is no recovering it, which is why it is not offered to a
    plain member of staff.
    """
    if not claims.is_ctf_organizer:
        raise AppError(ErrorCode.NOT_ORGANIZER, "ctf_organizer role required")
    await svc.delete(event_id, actor_id=claims.user_id)
    return Response(status_code=204)


@router.get("/{event_id}/my-participation", response_model=ParticipantRead | None)
async def my_participation(
    event_id: UUID,
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
    claims: Claims = Depends(get_claims),
    reg: RegistrationService = Depends(get_registration_service),
) -> ParticipantRead | None:
    p = await reg.get_my_participation(
        event_id, user_id=claims.user_id, bearer=authorization
    )
    if not p:
        return None
    return ParticipantRead.model_validate(p)


@router.post(
    "/{event_id}/disqualify/{participant_id}", response_model=ParticipantRead
)
async def disqualify(
    event_id: UUID,
    participant_id: UUID,
    body: DisqualifyRequest,
    claims: Claims = Depends(get_claims),
    reg: RegistrationService = Depends(get_registration_service),
    publisher: CtfEventPublisher = Depends(get_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> ParticipantRead:
    if not claims.is_ctf_organizer:
        raise AppError(ErrorCode.NOT_ORGANIZER, "only organizers can disqualify")
    p = await reg.disqualify(event_id, participant_id, reason=body.reason)
    await publisher.publish(
        event_type=EventType.PARTICIPANT_DISQUALIFIED,
        subject_id=event_id,
        actor_id=claims.user_id,
        payload={"participant_id": str(participant_id), "reason": body.reason},
        request_id=request_id,
    )
    return ParticipantRead.model_validate(p)


# =============================================================================
# Leaderboard
# =============================================================================


@router.get("/{event_id}/leaderboard", response_model=LeaderboardResponse)
async def leaderboard(
    event_id: UUID,
    limit: int = Query(100, ge=1, le=1000),
    claims: Claims | None = Depends(get_optional_claims),
    svc: EventService = Depends(get_event_service),
) -> LeaderboardResponse:
    from datetime import datetime, timezone

    is_organizer = bool(claims and claims.is_ctf_organizer)
    await svc.assert_scoreboard_visible(
        event_id,
        viewer_user_id=claims.user_id if claims else None,
        viewer_is_organizer=is_organizer,
    )
    entries, frozen = await svc.get_leaderboard(
        event_id,
        viewer_is_organizer=is_organizer,
        limit=limit,
    )
    return LeaderboardResponse(
        event_id=event_id,
        frozen=frozen,
        generated_at=datetime.now(timezone.utc),
        entries=entries,
    )


@router.get("/{event_id}/scoreboard.csv")
async def scoreboard_csv(
    event_id: UUID,
    claims: Claims = Depends(get_claims),
    svc: EventService = Depends(get_event_service),
) -> Response:
    if not claims.is_ctf_organizer:
        raise AppError(ErrorCode.NOT_ORGANIZER, "organizer only")
    csv_text = await svc.export_scoreboard_csv(event_id)
    return Response(
        content=csv_text,
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="scoreboard-{event_id}.csv"',
        },
    )


# =============================================================================
# Announcements
# =============================================================================


@router.get("/{event_id}/announcements")
async def list_announcements(
    event_id: UUID,
    page: tuple[int, int] = Depends(pagination),
    svc: AnnouncementService = Depends(get_announcement_service),
) -> dict:
    limit, offset = page
    items, total = await svc.list_(event_id, limit=limit, offset=offset)
    return {
        "items": [AnnouncementRead.model_validate(a) for a in items],
        "meta": PageMeta(
            total=total, limit=limit, offset=offset, has_more=(offset + limit) < total
        ),
    }


@router.post(
    "/{event_id}/announcements",
    response_model=AnnouncementRead,
    status_code=status.HTTP_201_CREATED,
)
async def post_announcement(
    event_id: UUID,
    body: AnnouncementCreate,
    claims: Claims = Depends(get_claims),
    svc: AnnouncementService = Depends(get_announcement_service),
    publisher: CtfEventPublisher = Depends(get_publisher),
    broker: WebSocketBroker = Depends(get_ws_broker),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> AnnouncementRead:
    if not claims.is_ctf_organizer:
        raise AppError(ErrorCode.NOT_ORGANIZER, "organizer only")
    a = await svc.post(event_id, poster_id=claims.user_id, data=body)
    payload = {
        "type": "announcement",
        "announcement_id": str(a.id),
        "title": a.title,
        "body": a.body,
        "is_pinned": a.is_pinned,
        "challenge_id": str(a.challenge_id) if a.challenge_id else None,
    }
    await broker.broadcast_announcement(event_id, payload)
    await publisher.publish(
        event_type=EventType.ANNOUNCEMENT_POSTED,
        subject_id=event_id,
        actor_id=claims.user_id,
        payload={"announcement_id": str(a.id), "title": a.title},
        request_id=request_id,
    )
    return AnnouncementRead.model_validate(a)
