"""Per-team challenge containers.

The orchestrator owns the container; this owns the question of *who is allowed
one and when*. Those are different concerns and they live in different places:
ctf-svc knows the event, the participant and the challenge; the orchestrator
knows Docker.

Per team, not per player. See migration ctf/0016 for the reasoning; the rule is
enforced by a partial unique index, so this code races two teammates pressing
Spawn and lets the loser join the winner's instance instead of erroring.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

import httpx
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import AppError, ErrorCode
from app.core.logging import get_logger
from app.models.event import ChallengeInstance, EventChallenge, EventParticipant

log = get_logger("instances")

LIVE = ("queued", "running")


class InstanceService:
    def __init__(self, session: AsyncSession, settings: Settings) -> None:
        self._db = session
        self._cfg = settings

    # ------------------------------------------------------------- reading
    async def get_for_participant(
        self, challenge_id: UUID, participant: EventParticipant
    ) -> ChallengeInstance | None:
        """The team's live instance for this challenge, if any.

        A teammate who did not press the button still gets the address — that
        is the whole point of the instance being the team's.
        """
        stmt = select(ChallengeInstance).where(
            ChallengeInstance.challenge_id == challenge_id,
            ChallengeInstance.status.in_(LIVE),
            *self._subject_filter(participant),
        )
        inst = (await self._db.execute(stmt)).scalar_one_or_none()
        if inst is None:
            return None
        # An expired row still holds the slot until something notices. This is
        # the something: the next reader retires it.
        if inst.expires_at <= datetime.now(timezone.utc):
            await self._mark_stopped(inst, reason="expired")
            return None
        return inst

    def _subject_filter(self, participant: EventParticipant) -> list[Any]:
        if participant.team_id:
            return [ChallengeInstance.team_id == participant.team_id]
        return [ChallengeInstance.user_id == participant.user_id]

    # ------------------------------------------------------------ spawning
    async def spawn(
        self,
        *,
        event_id: UUID,
        challenge: EventChallenge,
        participant: EventParticipant,
        actor_id: UUID,
        actor_name: str,
    ) -> tuple[ChallengeInstance, bool]:
        """Start the team's container. Returns (instance, created).

        `created` is False when the team already had one — pressing Spawn twice
        should hand back the same box, not refuse.
        """
        if not challenge.image_ref:
            raise AppError(
                ErrorCode.VALIDATION,
                "this challenge has no container to spawn",
            )

        existing = await self.get_for_participant(challenge.id, participant)
        if existing is not None:
            return existing, False

        ttl = timedelta(minutes=self._cfg.challenge_instance_ttl_minutes)
        expires_at = datetime.now(timezone.utc) + ttl

        inst = ChallengeInstance(
            event_id=event_id,
            challenge_id=challenge.id,
            team_id=participant.team_id,
            user_id=None if participant.team_id else participant.user_id,
            spawned_by=actor_id,
            spawned_by_name=actor_name,
            status="queued",
            expires_at=expires_at,
        )
        self._db.add(inst)
        try:
            await self._db.flush()
        except IntegrityError:
            # A teammate won the race. Their instance is the team's instance.
            await self._db.rollback()
            other = await self.get_for_participant(challenge.id, participant)
            if other is not None:
                return other, False
            raise

        # Only now, with the slot held, do we spend real resources.
        try:
            started = await self._start_container(challenge, inst)
        except Exception as exc:  # noqa: BLE001 — recorded and surfaced
            inst.status = "error"
            inst.error = str(exc)[:500]
            inst.stopped_at = datetime.now(timezone.utc)
            await self._db.commit()
            log.error("instance_spawn_failed", challenge_id=str(challenge.id), error=str(exc))
            raise AppError(
                ErrorCode.INTERNAL, "could not start the instance — try again in a moment"
            ) from exc

        inst.container_ref = started.get("ref")
        inst.host = started.get("host") or None
        inst.port = started.get("port") or None
        inst.status = "running"
        await self._db.commit()
        await self._db.refresh(inst)
        return inst, True

    async def _start_container(
        self, challenge: EventChallenge, inst: ChallengeInstance
    ) -> dict[str, Any]:
        port = self._challenge_port(challenge)
        payload = {
            "image": challenge.image_ref,
            "ports": [port],
            "ttl_seconds": self._cfg.challenge_instance_ttl_minutes * 60,
            "label": f"ctf-{str(challenge.id)[:8]}",
            "env": {
                # The challenge's own flag, so the container can serve it.
                # Static-flag challenges leave this empty and bake it in.
                "CTF_INSTANCE_ID": str(inst.id),
            },
        }
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(
                f"{self._cfg.orchestrator_url}/internal/containers",
                json=payload,
                headers=self._internal_headers(),
            )
        if res.status_code >= 400:
            raise RuntimeError(f"orchestrator returned {res.status_code}: {res.text[:200]}")
        return res.json()

    def _internal_headers(self) -> dict[str, str]:
        return {"X-Internal-Token": self._cfg.orchestrator_internal_token}

    def _challenge_port(self, challenge: EventChallenge) -> int:
        """The port inside the container.

        `connection_url` doubles as the author's declaration of it for
        instanced challenges — "nc host 9001" or ":9001" both mean 9001.
        """
        raw = (challenge.connection_url or "").strip()
        if raw:
            tail = raw.rsplit(":", 1)[-1].split("/")[0].strip()
            if tail.isdigit():
                candidate = int(tail)
                if 1 <= candidate <= 65535:
                    return candidate
        return self._cfg.challenge_default_port

    # ------------------------------------------------------------ stopping
    async def stop(self, inst: ChallengeInstance) -> None:
        if inst.container_ref:
            try:
                async with httpx.AsyncClient(timeout=20.0) as client:
                    await client.delete(
                        f"{self._cfg.orchestrator_url}/internal/containers/{inst.container_ref}",
                        headers=self._internal_headers(),
                    )
            except httpx.HTTPError as exc:
                # The row is retired regardless: a container we cannot reach is
                # the orchestrator's reaper's problem, and leaving the slot held
                # would block the team from ever spawning again.
                log.warning("instance_stop_unreachable", ref=inst.container_ref, error=str(exc))
        await self._mark_stopped(inst, reason="stopped")

    async def _mark_stopped(self, inst: ChallengeInstance, *, reason: str) -> None:
        await self._db.execute(
            update(ChallengeInstance)
            .where(ChallengeInstance.id == inst.id)
            .values(status="stopped", stopped_at=datetime.now(timezone.utc))
        )
        await self._db.commit()
        log.info("instance_retired", instance_id=str(inst.id), reason=reason)
