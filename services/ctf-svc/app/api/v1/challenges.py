"""Event-challenge HTTP endpoints."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, status, Header

from app.api.deps import (
    get_challenge_service,
    get_claims,
    get_instance_service,
    get_publisher,
    get_registration_service,
    get_request_id,
    get_submission_service,
    get_ws_broker,
)
from app.core.auth import Claims
from app.core.errors import AppError, ErrorCode
from app.models.event import ChallengeInstance, EventParticipant
from app.schemas import (
    ChallengeInstanceRead,
    EventChallengeCreate,
    EventChallengeList,
    EventChallengeOrganizerList,
    EventChallengeOrganizerRead,
    EventChallengeRead,
    EventChallengeUpdate,
    FlagSubmitRequest,
    FlagSubmitResponse,
    HintUnlockResponse,
)
from app.services import (
    ChallengeService,
    CtfEventPublisher,
    EventType,
    InstanceService,
    RegistrationService,
    SubmissionService,
)
from app.ws import WebSocketBroker

router = APIRouter(prefix="/events/{event_id}/challenges", tags=["challenges"])


# response_model is left off so the organizer branch can return a wider model.
# Declaring the narrow one here would strip the organizer-only fields back out
# on the way to the wire, which is how `image_ref` would quietly stop reaching
# the challenge editor.
@router.get("", response_model=None)
async def list_event_challenges(
    event_id: UUID,
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
    claims: Claims = Depends(get_claims),
    ch_svc: ChallengeService = Depends(get_challenge_service),
    reg_svc: RegistrationService = Depends(get_registration_service),
) -> EventChallengeList | EventChallengeOrganizerList:
    # Resolve viewer's participation (None for organizers viewing)
    participant = await reg_svc.get_my_participation(
        event_id, user_id=claims.user_id, bearer=authorization
    )
    challenges, solved_ids = await ch_svc.list_for_event(
        event_id,
        viewer_participant_id=participant.id if participant else None,
        viewer_is_organizer=claims.is_ctf_organizer,
    )

    # One query for the whole list rather than one per challenge.
    unlocked = (
        await ch_svc.unlocked_hint_ids(event_id, participant.id) if participant else {}
    )

    model = (
        EventChallengeOrganizerRead if claims.is_ctf_organizer else EventChallengeRead
    )
    items = []
    for c in challenges:
        view = model.model_validate(c)
        view.hint_summaries = ch_svc.hint_summaries(c, unlocked.get(c.id))
        view.is_solved = c.id in solved_ids
        items.append(view)
    if claims.is_ctf_organizer:
        return EventChallengeOrganizerList(items=items)
    return EventChallengeList(items=items)


@router.get(
    "/{challenge_id}",
    response_model=EventChallengeOrganizerRead | EventChallengeRead,
)
async def get_event_challenge(
    event_id: UUID,
    challenge_id: UUID,
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
    claims: Claims = Depends(get_claims),
    ch_svc: ChallengeService = Depends(get_challenge_service),
    reg_svc: RegistrationService = Depends(get_registration_service),
) -> EventChallengeRead | EventChallengeOrganizerRead:
    challenge = await ch_svc.get(challenge_id)
    if challenge.event_id != event_id:
        raise AppError(ErrorCode.CHALLENGE_NOT_FOUND, "challenge not in this event")

    if claims.is_ctf_organizer:
        view = EventChallengeOrganizerRead.model_validate(challenge)
        view.hint_summaries = ch_svc.hint_summaries(challenge)
        view.hints = challenge.hints
        return view

    # Non-organizers: enforce unlocked
    participant = await reg_svc.get_my_participation(
        event_id, user_id=claims.user_id, bearer=authorization
    )
    await ch_svc.check_unlocked(
        challenge,
        viewer_participant_id=participant.id if participant else None,
        viewer_is_organizer=False,
    )

    view = EventChallengeRead.model_validate(challenge)
    unlocked = (
        await ch_svc.unlocked_hint_ids(event_id, participant.id) if participant else {}
    )
    view.hint_summaries = ch_svc.hint_summaries(challenge, unlocked.get(challenge.id))
    if participant:
        from sqlalchemy import select
        from app.models import EventSolve

        # Use the same session via the service
        solved_result = await ch_svc.session.execute(
            select(EventSolve.challenge_id).where(
                EventSolve.participant_id == participant.id
            )
        )
        solved = {row[0] for row in solved_result}
        view.is_solved = challenge_id in solved
    return view


@router.post(
    "", response_model=EventChallengeOrganizerRead, status_code=status.HTTP_201_CREATED
)
async def create_event_challenge(
    event_id: UUID,
    body: EventChallengeCreate,
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
    claims: Claims = Depends(get_claims),
    ch_svc: ChallengeService = Depends(get_challenge_service),
    publisher: CtfEventPublisher = Depends(get_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> EventChallengeOrganizerRead:
    if not claims.is_ctf_organizer:
        raise AppError(ErrorCode.NOT_ORGANIZER, "organizer only")
    challenge = await ch_svc.create(event_id, data=body)
    await publisher.publish(
        event_type=EventType.CHALLENGE_ADDED,
        subject_id=event_id,
        actor_id=claims.user_id,
        payload={"challenge_id": str(challenge.id), "name": challenge.name},
        request_id=request_id,
    )
    view = EventChallengeOrganizerRead.model_validate(challenge)
    view.hint_summaries = ch_svc.hint_summaries(challenge)
    view.hints = challenge.hints
    return view


@router.patch("/{challenge_id}", response_model=EventChallengeOrganizerRead)
async def update_event_challenge(
    event_id: UUID,
    challenge_id: UUID,
    body: EventChallengeUpdate,
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
    claims: Claims = Depends(get_claims),
    ch_svc: ChallengeService = Depends(get_challenge_service),
    publisher: CtfEventPublisher = Depends(get_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> EventChallengeOrganizerRead:
    if not claims.is_ctf_organizer:
        raise AppError(ErrorCode.NOT_ORGANIZER, "organizer only")
    challenge = await ch_svc.update(challenge_id, data=body)
    if challenge.event_id != event_id:
        raise AppError(ErrorCode.CHALLENGE_NOT_FOUND, "challenge not in this event")
    await publisher.publish(
        event_type=EventType.CHALLENGE_UPDATED,
        subject_id=event_id,
        actor_id=claims.user_id,
        payload={"challenge_id": str(challenge_id)},
        request_id=request_id,
    )
    view = EventChallengeOrganizerRead.model_validate(challenge)
    view.hint_summaries = ch_svc.hint_summaries(challenge)
    view.hints = challenge.hints
    return view


# =============================================================================
# Submission
# =============================================================================


@router.delete("/{challenge_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_event_challenge(
    event_id: UUID,
    challenge_id: UUID,
    claims: Claims = Depends(get_claims),
    ch_svc: ChallengeService = Depends(get_challenge_service),
) -> None:
    """Delete a challenge from an event. Organizer only."""
    if not claims.is_ctf_organizer:
        raise AppError(ErrorCode.NOT_ORGANIZER, "organizer only")

    await ch_svc.delete(challenge_id, event_id=event_id)


@router.post("/{challenge_id}/submit", response_model=FlagSubmitResponse)
async def submit_flag(
    event_id: UUID,
    challenge_id: UUID,
    body: FlagSubmitRequest,
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
    claims: Claims = Depends(get_claims),
    sub_svc: SubmissionService = Depends(get_submission_service),
    reg_svc: RegistrationService = Depends(get_registration_service),
    ch_svc: ChallengeService = Depends(get_challenge_service),
    publisher: CtfEventPublisher = Depends(get_publisher),
    broker: WebSocketBroker = Depends(get_ws_broker),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> FlagSubmitResponse:
    participant = await reg_svc.get_my_participation(
        event_id, user_id=claims.user_id, bearer=authorization
    )
    if not participant:
        raise AppError(ErrorCode.NOT_REGISTERED, "register for the event first")

    result = await sub_svc.submit(
        event_id=event_id,
        challenge_id=challenge_id,
        participant=participant,
        submitting_user_id=claims.user_id,
        flag=body.flag,
    )

    # Broadcast solve to live feed.
    #
    # Carries the challenge name and the player's name, not just ids: the feed
    # renders "<player> has pwned <challenge>" and must not have to resolve a
    # uuid client-side to do it.
    solved = await ch_svc.get(challenge_id)
    ws_payload = {
        "type": "solve",
        "challenge_id": str(challenge_id),
        "challenge_name": solved.name,
        "participant_id": str(participant.id),
        "player_name": _actor_name(claims, participant),
        "team_name": participant.team_name_at_event,
        "is_first_blood": result["is_first_blood"],
        "points_awarded": result["points_awarded"],
        "new_total_points": result["new_total_points"],
        "new_rank": result["new_rank"],
    }
    await broker.broadcast(event_id, ws_payload)

    # Kafka events
    await publisher.publish(
        event_type=EventType.SOLVE_RECORDED,
        subject_id=event_id,
        actor_id=claims.user_id,
        payload={
            "challenge_id": str(challenge_id),
            "participant_id": str(participant.id),
            "points": result["points_awarded"],
            # Which season this belongs to is decided by when the event ends,
            # not by when the flag was submitted.
            "event_ends_at": result.get("event_ends_at"),
        },
        request_id=request_id,
    )
    if result["is_first_blood"]:
        await publisher.publish(
            event_type=EventType.FIRST_BLOOD_AWARDED,
            subject_id=event_id,
            actor_id=claims.user_id,
            payload={
                "challenge_id": str(challenge_id),
                "participant_id": str(participant.id),
            },
            request_id=request_id,
        )

    return FlagSubmitResponse(
        accepted=True,
        message="flag accepted",
        is_first_blood=result["is_first_blood"],
        points_awarded=result["points_awarded"],
        new_total_points=result["new_total_points"],
        new_rank=result["new_rank"],
    )


# =============================================================================
# Hint unlock
# =============================================================================


@router.post(
    "/{challenge_id}/hints/{hint_id}",
    response_model=HintUnlockResponse,
)
async def unlock_hint(
    event_id: UUID,
    challenge_id: UUID,
    hint_id: str,
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
    claims: Claims = Depends(get_claims),
    sub_svc: SubmissionService = Depends(get_submission_service),
    reg_svc: RegistrationService = Depends(get_registration_service),
    publisher: CtfEventPublisher = Depends(get_publisher),
    request_id: Annotated[str, Depends(get_request_id)] = "",
) -> HintUnlockResponse:
    participant = await reg_svc.get_my_participation(
        event_id, user_id=claims.user_id, bearer=authorization
    )
    if not participant:
        raise AppError(ErrorCode.NOT_REGISTERED, "register for the event first")

    result = await sub_svc.unlock_hint(
        event_id=event_id,
        challenge_id=challenge_id,
        participant=participant,
        unlocking_user_id=claims.user_id,
        hint_id=hint_id,
    )
    await publisher.publish(
        event_type=EventType.HINT_UNLOCKED,
        subject_id=event_id,
        actor_id=claims.user_id,
        payload={
            "challenge_id": str(challenge_id),
            "hint_id": hint_id,
            "participant_id": str(participant.id),
        },
        request_id=request_id,
    )
    return HintUnlockResponse(**result)


# =============================================================================
# Per-team instances
# =============================================================================
#
# The instance belongs to the team, so all three routes resolve the team from
# the caller's own participation rather than from anything they send.


def _actor_name(claims: Claims, participant: EventParticipant) -> str:
    """A name to put in the live feed — never a raw user id.

    The JWT carries the username, so this costs no lookup. The participant's
    captured display name is the fallback for a token minted before usernames
    were in claims; the truncated id is the last resort and should not be
    reachable in practice.
    """
    return claims.username or participant.display_name or f"player-{str(claims.user_id)[:8]}"


def _instance_read(inst: ChallengeInstance, *, created: bool = False) -> ChallengeInstanceRead:
    connection = f"{inst.host}:{inst.port}" if inst.host and inst.port else None
    return ChallengeInstanceRead(
        id=inst.id,
        challenge_id=inst.challenge_id,
        status=inst.status,
        host=inst.host,
        port=inst.port,
        connection=connection,
        error=inst.error,
        expires_at=inst.expires_at,
        created_at=inst.created_at,
        spawned_by_name=inst.spawned_by_name,
        created=created,
    )


@router.get("/{challenge_id}/instance", response_model=ChallengeInstanceRead | None)
async def get_instance(
    event_id: UUID,
    challenge_id: UUID,
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
    claims: Claims = Depends(get_claims),
    reg_svc: RegistrationService = Depends(get_registration_service),
    inst_svc: InstanceService = Depends(get_instance_service),
) -> ChallengeInstanceRead | None:
    """The team's live instance, or null. Any teammate sees it, not just the
    one who started it."""
    participant = await reg_svc.get_my_participation(
        event_id, user_id=claims.user_id, bearer=authorization
    )
    if not participant:
        raise AppError(ErrorCode.NOT_REGISTERED, "register for the event first")

    inst = await inst_svc.get_for_participant(challenge_id, participant)
    return _instance_read(inst) if inst else None


@router.post(
    "/{challenge_id}/instance",
    response_model=ChallengeInstanceRead,
    status_code=status.HTTP_201_CREATED,
)
async def spawn_instance(
    event_id: UUID,
    challenge_id: UUID,
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
    claims: Claims = Depends(get_claims),
    reg_svc: RegistrationService = Depends(get_registration_service),
    ch_svc: ChallengeService = Depends(get_challenge_service),
    inst_svc: InstanceService = Depends(get_instance_service),
    broker: WebSocketBroker = Depends(get_ws_broker),
) -> ChallengeInstanceRead:
    participant = await reg_svc.get_my_participation(
        event_id, user_id=claims.user_id, bearer=authorization
    )
    if not participant:
        raise AppError(ErrorCode.NOT_REGISTERED, "register for the event first")
    if participant.is_disqualified:
        raise AppError(ErrorCode.FORBIDDEN, "this entry is disqualified")

    challenge = await ch_svc.get(challenge_id)
    if challenge.event_id != event_id:
        raise AppError(ErrorCode.NOT_FOUND, "challenge not found in this event")
    # Raises if locked or a prerequisite is unsolved.
    await ch_svc.check_unlocked(
        challenge,
        viewer_participant_id=participant.id,
        viewer_is_organizer=claims.is_ctf_organizer,
    )

    name = _actor_name(claims, participant)
    inst, created = await inst_svc.spawn(
        event_id=event_id,
        challenge=challenge,
        participant=participant,
        actor_id=claims.user_id,
        actor_name=name,
    )
    if created:
        # Everyone in the event sees it — that is the point. Announcing a
        # re-fetch of an instance the team already had would be noise, so only
        # a real spawn is broadcast.
        await broker.broadcast(
            event_id,
            {
                "type": "instance_spawned",
                "player_name": name,
                "challenge_id": str(challenge_id),
                "challenge_name": challenge.name,
                "team_name": participant.team_name_at_event,
            },
        )

    return _instance_read(inst, created=created)


@router.delete(
    "/{challenge_id}/instance", status_code=status.HTTP_204_NO_CONTENT, response_model=None
)
async def stop_instance(
    event_id: UUID,
    challenge_id: UUID,
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
    claims: Claims = Depends(get_claims),
    reg_svc: RegistrationService = Depends(get_registration_service),
    inst_svc: InstanceService = Depends(get_instance_service),
) -> None:
    """Stop the team's instance. Any teammate may — they share the box."""
    participant = await reg_svc.get_my_participation(
        event_id, user_id=claims.user_id, bearer=authorization
    )
    if not participant:
        raise AppError(ErrorCode.NOT_REGISTERED, "register for the event first")

    inst = await inst_svc.get_for_participant(challenge_id, participant)
    if inst is None:
        return
    await inst_svc.stop(inst)
