"""Event-challenge HTTP endpoints."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, status, Header

from app.api.deps import (
    get_challenge_service,
    get_claims,
    get_publisher,
    get_registration_service,
    get_request_id,
    get_submission_service,
    get_ws_broker,
)
from app.core.auth import Claims
from app.core.errors import AppError, ErrorCode
from app.schemas import (
    EventChallengeCreate,
    EventChallengeList,
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
    RegistrationService,
    SubmissionService,
)
from app.ws import WebSocketBroker

router = APIRouter(prefix="/events/{event_id}/challenges", tags=["challenges"])


@router.get("", response_model=EventChallengeList)
async def list_event_challenges(
    event_id: UUID,
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
    claims: Claims = Depends(get_claims),
    ch_svc: ChallengeService = Depends(get_challenge_service),
    reg_svc: RegistrationService = Depends(get_registration_service),
) -> EventChallengeList:
    # Resolve viewer's participation (None for organizers viewing)
    participant = await reg_svc.get_my_participation(
        event_id, user_id=claims.user_id, bearer=authorization
    )
    challenges, solved_ids = await ch_svc.list_for_event(
        event_id,
        viewer_participant_id=participant.id if participant else None,
        viewer_is_organizer=claims.is_ctf_organizer,
    )

    items: list[EventChallengeRead] = []
    for c in challenges:
        view = EventChallengeRead.model_validate(c)
        view.hint_summaries = ch_svc.hint_summaries(c)
        view.is_solved = c.id in solved_ids
        items.append(view)
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
    view.hint_summaries = ch_svc.hint_summaries(challenge)
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


@router.post("/{challenge_id}/submit", response_model=FlagSubmitResponse)
async def submit_flag(
    event_id: UUID,
    challenge_id: UUID,
    body: FlagSubmitRequest,
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
    claims: Claims = Depends(get_claims),
    sub_svc: SubmissionService = Depends(get_submission_service),
    reg_svc: RegistrationService = Depends(get_registration_service),
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

    # Broadcast solve to live feed
    ws_payload = {
        "type": "solve",
        "challenge_id": str(challenge_id),
        "participant_id": str(participant.id),
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
