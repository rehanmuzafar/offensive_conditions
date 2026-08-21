"""Event HTTP endpoints."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Response, status
from pydantic import BaseModel

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


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_event(
    event_id: UUID,
    claims: Claims = Depends(get_claims),
    svc: EventService = Depends(get_event_service),
) -> None:
    """Delete an event and everything under it.

    Organizer-or-creator, enforced in the service so the rule cannot be skipped
    by another caller. Refused while the event is live — see EventService.delete.
    """
    await svc.delete(event_id, actor_id=claims.user_id, is_organizer=claims.is_ctf_organizer)


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
# Organiser score control
#
# Available in every event state on purpose: sanctions arrive before an event,
# penalties during it, and jury corrections after it has ended.
# =============================================================================


class ScoreAdjustmentRequest(BaseModel):
    """Signed points against one entry, with a reason that is not optional."""

    team_id: UUID | None = None
    user_id: UUID | None = None
    delta: int
    #: Optional for a quiet correction; required when `visible` is set.
    reason: str | None = None
    #: Publish this on the scoreboard, with its reason, beside the team.
    visible: bool = False


class BanRequest(BaseModel):
    team_id: UUID | None = None
    user_id: UUID | None = None
    banned: bool
    reason: str | None = None


@router.get("/{event_id}/entries")
async def list_entries(
    event_id: UUID,
    claims: Claims = Depends(get_claims),
    svc: EventService = Depends(get_event_service),
) -> dict:
    """Every entry, banned ones included — the organiser's view of the board.

    Not the leaderboard: that hides disqualified rows, which would make a banned
    team unreachable from the screen used to reinstate it.
    """
    event = await svc.get(event_id)
    if not claims.is_ctf_organizer and event.created_by != claims.user_id:
        raise AppError(ErrorCode.NOT_ORGANIZER, "only the organizer can see this")
    return {"items": await svc.list_entries_for_admin(event_id)}


@router.post("/{event_id}/adjustments", status_code=status.HTTP_201_CREATED)
async def create_adjustment(
    event_id: UUID,
    body: ScoreAdjustmentRequest,
    claims: Claims = Depends(get_claims),
    svc: EventService = Depends(get_event_service),
    broker: WebSocketBroker = Depends(get_ws_broker),
) -> dict:
    adj = await svc.adjust_score(
        event_id,
        actor_id=claims.user_id,
        is_organizer=claims.is_ctf_organizer,
        delta=body.delta,
        reason=body.reason,
        visible=body.visible,
        team_id=body.team_id,
        user_id=body.user_id,
    )
    await broker.broadcast(event_id, {"type": "scoreboard.changed", "event_id": str(event_id)})
    return {
        "id": str(adj.id),
        "delta": adj.delta,
        "reason": adj.reason,
        "visible": adj.visible,
        "team_id": str(adj.team_id) if adj.team_id else None,
        "user_id": str(adj.user_id) if adj.user_id else None,
        "created_at": adj.created_at.isoformat() if adj.created_at else None,
    }


@router.get("/{event_id}/adjustments")
async def list_adjustments(
    event_id: UUID,
    claims: Claims = Depends(get_claims),
    svc: EventService = Depends(get_event_service),
) -> dict:
    """The audit trail. Organisers only — it names who changed what and why."""
    event = await svc.get(event_id)
    if not claims.is_ctf_organizer and event.created_by != claims.user_id:
        raise AppError(ErrorCode.NOT_ORGANIZER, "only the organizer can read adjustments")
    rows = await svc.list_adjustments(event_id)
    return {
        "items": [
            {
                "id": str(a.id),
                "team_id": str(a.team_id) if a.team_id else None,
                "user_id": str(a.user_id) if a.user_id else None,
                "delta": a.delta,
                "reason": a.reason,
                "visible": a.visible,
                "actor_id": str(a.actor_id),
                "created_at": a.created_at.isoformat() if a.created_at else None,
            }
            for a in rows
        ]
    }


class RankPinRequest(BaseModel):
    """Fix an entry at a displayed position.

    A pin overrides the points ordering for one row, so the reason travels with
    it and every pinned row is marked as such on the board.
    """

    team_id: UUID | None = None
    user_id: UUID | None = None
    position: int
    reason: str | None = None


@router.get("/{event_id}/rank-pins")
async def list_rank_pins(
    event_id: UUID,
    claims: Claims = Depends(get_claims),
    svc: EventService = Depends(get_event_service),
) -> dict:
    event = await svc.get(event_id)
    if not claims.is_ctf_organizer and event.created_by != claims.user_id:
        raise AppError(ErrorCode.NOT_ORGANIZER, "only the organizer can see this")
    return {
        "items": [
            {
                "id": str(p.id),
                "team_id": str(p.team_id) if p.team_id else None,
                "user_id": str(p.user_id) if p.user_id else None,
                "position": p.position,
                "reason": p.reason,
                "created_at": p.created_at.isoformat() if p.created_at else None,
            }
            for p in await svc.list_rank_pins(event_id)
        ]
    }


@router.post("/{event_id}/rank-pins", status_code=status.HTTP_201_CREATED)
async def set_rank_pin(
    event_id: UUID,
    body: RankPinRequest,
    claims: Claims = Depends(get_claims),
    svc: EventService = Depends(get_event_service),
    broker: WebSocketBroker = Depends(get_ws_broker),
) -> dict:
    pin = await svc.set_rank_pin(
        event_id,
        actor_id=claims.user_id,
        is_organizer=claims.is_ctf_organizer,
        position=body.position,
        reason=body.reason,
        team_id=body.team_id,
        user_id=body.user_id,
    )
    await broker.broadcast(event_id, {"type": "scoreboard.changed", "event_id": str(event_id)})
    return {"id": str(pin.id), "position": pin.position, "reason": pin.reason}


class BoardOrderRow(BaseModel):
    team_id: UUID | None = None
    user_id: UUID | None = None
    #: False for rows the organiser never moved — they keep following points.
    pinned: bool = True


class BoardOrderRequest(BaseModel):
    """The board's final order, as dragged."""

    order: list[BoardOrderRow]
    reason: str | None = None


@router.put("/{event_id}/board-order")
async def reorder_board(
    event_id: UUID,
    body: BoardOrderRequest,
    claims: Claims = Depends(get_claims),
    svc: EventService = Depends(get_event_service),
    broker: WebSocketBroker = Depends(get_ws_broker),
) -> dict:
    """Replace the displayed order in one call.

    A PUT rather than a series of pins: dragging one row moves everything
    between it and its new home, and sending that as N requests would leave the
    board half-reordered if one of them failed.
    """
    written = await svc.reorder_board(
        event_id,
        actor_id=claims.user_id,
        is_organizer=claims.is_ctf_organizer,
        order=[row.model_dump(mode="json") for row in body.order],
        reason=body.reason,
    )
    await broker.broadcast(event_id, {"type": "scoreboard.changed", "event_id": str(event_id)})
    return {"pinned": written}


@router.delete(
    "/{event_id}/rank-pins", status_code=status.HTTP_204_NO_CONTENT, response_model=None
)
async def clear_rank_pin(
    event_id: UUID,
    team_id: UUID | None = None,
    user_id: UUID | None = None,
    claims: Claims = Depends(get_claims),
    svc: EventService = Depends(get_event_service),
    broker: WebSocketBroker = Depends(get_ws_broker),
) -> None:
    await svc.clear_rank_pin(
        event_id,
        actor_id=claims.user_id,
        is_organizer=claims.is_ctf_organizer,
        team_id=team_id,
        user_id=user_id,
    )
    await broker.broadcast(event_id, {"type": "scoreboard.changed", "event_id": str(event_id)})


@router.post("/{event_id}/ban", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def set_ban(
    event_id: UUID,
    body: BanRequest,
    claims: Claims = Depends(get_claims),
    svc: EventService = Depends(get_event_service),
    broker: WebSocketBroker = Depends(get_ws_broker),
) -> None:
    await svc.set_disqualified(
        event_id,
        actor_id=claims.user_id,
        is_organizer=claims.is_ctf_organizer,
        banned=body.banned,
        reason=body.reason,
        team_id=body.team_id,
        user_id=body.user_id,
    )
    await broker.broadcast(event_id, {"type": "scoreboard.changed", "event_id": str(event_id)})


# =============================================================================
# Pause
# =============================================================================


class PauseRequest(BaseModel):
    """Either half may be sent alone.

    `paused` is the button; `starts_at`/`ends_at` is the schedule. Sending
    `paused: false` also clears any schedule — see EventService.set_pause.
    """

    paused: bool | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    reason: str | None = None


@router.post("/{event_id}/pause", response_model=EventRead)
async def set_pause(
    event_id: UUID,
    body: PauseRequest,
    claims: Claims = Depends(get_claims),
    svc: EventService = Depends(get_event_service),
    broker: WebSocketBroker = Depends(get_ws_broker),
) -> EventRead:
    event = await svc.set_pause(
        event_id,
        actor_id=claims.user_id,
        is_organizer=claims.is_ctf_organizer,
        paused=body.paused,
        starts_at=body.starts_at,
        ends_at=body.ends_at,
        reason=body.reason,
    )
    # Players sitting in the arena need to hear this without polling — the whole
    # point of a pause is that it takes effect now.
    await broker.broadcast(
        event_id,
        {"type": "event.pause", "event_id": str(event_id), "paused": event.is_paused},
    )
    return EventRead.model_validate(event)


@router.delete("/{event_id}/pause/schedule", response_model=EventRead)
async def clear_pause_schedule(
    event_id: UUID,
    claims: Claims = Depends(get_claims),
    svc: EventService = Depends(get_event_service),
) -> EventRead:
    event = await svc.clear_pause_schedule(
        event_id, actor_id=claims.user_id, is_organizer=claims.is_ctf_organizer
    )
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


# =============================================================================
# Captain roster control
#
# A team's slots belong to the team. On a four-slot event the wrong four
# teammates may have entered first, so the captain can take a seat back and give
# it to someone else — but only before the event starts, because after that a
# participant owns solves and a rank.
# =============================================================================


class RosterMember(BaseModel):
    user_id: UUID
    username: str | None = None
    role: str | None = None
    entered: bool


@router.get("/{event_id}/roster")
async def get_roster(
    event_id: UUID,
    team_id: UUID,
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
    claims: Claims = Depends(get_claims),
    reg: RegistrationService = Depends(get_registration_service),
    svc: EventService = Depends(get_event_service),
) -> dict:
    """The captain's whole team, marked with who is entered."""
    team_name, members = await UserServiceClient(get_settings()).get_team_roster(
        team_id, bearer=authorization or "", actor_id=claims.user_id
    )
    event = await svc.get(event_id)
    entered = {str(p.user_id) for p in await reg.roster(event_id, team_id) if p.user_id}

    return {
        "team_id": str(team_id),
        "team_name": team_name,
        "max_team_size": event.max_team_size,
        "locked": event.status not in ("published", "registration"),
        "members": [
            RosterMember(
                user_id=UUID(str(m["user_id"])),
                username=m.get("username") or m.get("display_name"),
                role=m.get("role"),
                entered=str(m.get("user_id")) in entered,
            ).model_dump(mode="json")
            for m in members
            if m.get("user_id")
        ],
    }


class RosterChange(BaseModel):
    team_id: UUID
    user_id: UUID


@router.post("/{event_id}/roster", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def roster_add(
    event_id: UUID,
    body: RosterChange,
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
    claims: Claims = Depends(get_claims),
    reg: RegistrationService = Depends(get_registration_service),
    publisher: CtfEventPublisher = Depends(get_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> None:
    # Verified with user-svc, not trusted from the body: it confirms the caller
    # captains the team *and* that the target is on it. Without the second check
    # a captain could enter any account on the platform under their name.
    team_name, members = await UserServiceClient(get_settings()).get_team_roster(
        body.team_id, bearer=authorization or "", actor_id=claims.user_id
    )
    if not any(str(m.get("user_id")) == str(body.user_id) for m in members):
        raise AppError(ErrorCode.VALIDATION, "that player is not on this team")

    await reg.add_member(
        event_id, team_id=body.team_id, team_name=team_name, user_id=body.user_id
    )
    await publisher.publish(
        event_type=EventType.REGISTRATION_CREATED,
        subject_id=event_id,
        actor_id=claims.user_id,
        payload={"type": "team", "team_id": str(body.team_id), "user_id": str(body.user_id)},
        request_id=request_id,
    )


@router.delete(
    "/{event_id}/roster/{user_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None
)
async def roster_remove(
    event_id: UUID,
    user_id: UUID,
    team_id: UUID,
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
    claims: Claims = Depends(get_claims),
    reg: RegistrationService = Depends(get_registration_service),
    publisher: CtfEventPublisher = Depends(get_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> None:
    await UserServiceClient(get_settings()).get_team_roster(
        team_id, bearer=authorization or "", actor_id=claims.user_id
    )
    await reg.remove_member(event_id, team_id=team_id, user_id=user_id)
    await publisher.publish(
        event_type=EventType.REGISTRATION_REMOVED,
        subject_id=event_id,
        actor_id=claims.user_id,
        payload={"team_id": str(team_id), "user_id": str(user_id)},
        request_id=request_id,
    )


@router.get("/{event_id}/team-slots")
async def team_slots(
    event_id: UUID,
    reg: RegistrationService = Depends(get_registration_service),
    svc: EventService = Depends(get_event_service),
) -> dict:
    """Players entered per team, and the per-team cap.

    The registration dialog needs both to say "2 of 4 entered" before anyone
    commits, and the participants list cannot answer it — that is paginated at
    100, so counting client-side is wrong on any event of real size.
    """
    event = await svc.get(event_id)
    counts = await reg.team_registration_counts(event_id)
    return {
        "max_team_size": event.max_team_size,
        "counts": {str(team_id): n for team_id, n in counts.items()},
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
    entries, eliminated, frozen = await svc.get_board(
        event_id,
        viewer_is_organizer=is_organizer,
        limit=limit,
    )
    return LeaderboardResponse(
        event_id=event_id,
        frozen=frozen,
        generated_at=datetime.now(timezone.utc),
        entries=entries,
        eliminated=eliminated,
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
