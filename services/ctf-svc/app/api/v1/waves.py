"""Event wave HTTP endpoints.

Reads are open to anyone who can see the event: players need to know when the
next round opens. Writes are organizer-only, and stay available while the event
is running — moving a wave mid-event is a normal thing for an organiser to do,
not an emergency.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, status

from app.api.deps import get_claims, get_wave_service
from app.core.auth import Claims
from app.core.errors import AppError, ErrorCode
from app.schemas import (
    EventWaveCreate,
    EventWaveList,
    EventWaveRead,
    EventWaveUpdate,
)
from app.services import WaveService

router = APIRouter(prefix="/events/{event_id}/waves", tags=["waves"])


def _organizer_only(claims: Claims) -> None:
    if not claims.is_ctf_organizer:
        raise AppError(ErrorCode.NOT_ORGANIZER, "organizer only")


@router.get("", response_model=EventWaveList)
async def list_waves(
    event_id: UUID,
    wave_svc: WaveService = Depends(get_wave_service),
) -> EventWaveList:
    rows = await wave_svc.list_for_event(event_id)
    return EventWaveList(items=[EventWaveRead(**r) for r in rows])


@router.post("", response_model=EventWaveRead, status_code=status.HTTP_201_CREATED)
async def create_wave(
    event_id: UUID,
    body: EventWaveCreate,
    claims: Claims = Depends(get_claims),
    wave_svc: WaveService = Depends(get_wave_service),
) -> EventWaveRead:
    _organizer_only(claims)
    wave = await wave_svc.create(event_id, body)
    return await _read(wave_svc, event_id, wave.id)


@router.patch("/{wave_id}", response_model=EventWaveRead)
async def update_wave(
    event_id: UUID,
    wave_id: UUID,
    body: EventWaveUpdate,
    claims: Claims = Depends(get_claims),
    wave_svc: WaveService = Depends(get_wave_service),
) -> EventWaveRead:
    _organizer_only(claims)
    await wave_svc.update(event_id, wave_id, body)
    return await _read(wave_svc, event_id, wave_id)


@router.delete("/{wave_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_wave(
    event_id: UUID,
    wave_id: UUID,
    claims: Claims = Depends(get_claims),
    wave_svc: WaveService = Depends(get_wave_service),
) -> None:
    """Delete a wave. Its challenges stay, unfiled and therefore open."""
    _organizer_only(claims)
    await wave_svc.delete(event_id, wave_id)


async def _read(wave_svc: WaveService, event_id: UUID, wave_id: UUID) -> EventWaveRead:
    """Re-read through the list so state and challenge_count are filled in."""
    for row in await wave_svc.list_for_event(event_id):
        if row["id"] == wave_id:
            return EventWaveRead(**row)
    raise AppError(ErrorCode.NOT_FOUND, "wave not found")
