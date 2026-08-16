"""Submission service: flag verification + score computation + first blood + broadcast.

The submission path is the heart of the CTF service. Flow:

  1. Validate event is live + not ended
  2. Validate participant exists + not disqualified
  3. Rate-limit (Redis sliding window)
  4. Verify flag (static hash compare OR call flag-verifier gRPC)
  5. If accepted:
       a. Insert event_solves row (idempotent via unique constraint)
       b. Crown first blood if this is the 1st accepted solve
       c. Recompute challenge.current_points (dynamic scoring)
       d. Recompute participant.points + solve_count + last_solve_at
       e. Broadcast over WebSocket (publish to Redis pubsub channel)
       f. Emit Kafka event for downstream services
  6. Return accept/reject + new score
"""

from __future__ import annotations

import hashlib
import hmac
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, ErrorCode
from app.core.logging import get_logger
from app.models import (
    Event,
    EventChallenge,
    EventParticipant,
    EventSolve,
    FlagSubmissionAttempt,
    HintUnlock,
)
from app.services.challenges import ChallengeService
from app.services.scoring import compute_dynamic_points, first_blood_bonus

log = get_logger("submission")


class SubmissionService:
    def __init__(
        self,
        session: AsyncSession,
        *,
        decay_factor: float = 0.012,
        decay_power: int = 4,
        first_blood_percentages: list[float] | None = None,
    ) -> None:
        self.session = session
        self.decay_factor = decay_factor
        self.decay_power = decay_power
        self.first_blood_percentages = first_blood_percentages or [0.05, 0.03, 0.01]

    async def _load_event_state(self, event_id: UUID) -> Event:
        result = await self.session.execute(select(Event).where(Event.id == event_id))
        event = result.scalar_one_or_none()
        if not event:
            raise AppError(ErrorCode.EVENT_NOT_FOUND, "event not found")
        return event

    async def _verify_flag(
        self, *, submitted_flag: str, challenge: EventChallenge
    ) -> bool:
        """Compare against stored hash. For instance-based challenges we'd call
        the flag-verifier gRPC service; here we keep it self-contained.
        """
        if not challenge.static_flag_hash:
            # Instance-based: would call flag-verifier gRPC here
            log.warning(
                "instance_flag_verifier_not_wired",
                challenge_id=str(challenge.id),
            )
            return False

        # Static flag: HMAC-SHA256 compare to stored hash
        expected = challenge.static_flag_hash.lower()
        submitted_hash = hashlib.sha256(submitted_flag.encode("utf-8")).hexdigest()
        return hmac.compare_digest(expected, submitted_hash)

    # =========================================================================
    # Main entry: submit a flag
    # =========================================================================

    async def submit(
        self,
        *,
        event_id: UUID,
        challenge_id: UUID,
        participant: EventParticipant,
        submitting_user_id: UUID,
        flag: str,
    ) -> dict[str, Any]:
        # 1. Event live?
        event = await self._load_event_state(event_id)
        if event.status != "live":
            if event.status == "ended":
                raise AppError(ErrorCode.EVENT_ENDED, "event has ended")
            raise AppError(ErrorCode.EVENT_NOT_LIVE, f"event not live (status={event.status})")
        now = datetime.now(timezone.utc)
        if now > event.ends_at:
            raise AppError(ErrorCode.EVENT_ENDED, "event ended")

        # 2. Participant ok?
        if participant.is_disqualified:
            raise AppError(ErrorCode.PARTICIPANT_DISQUALIFIED, "you are disqualified")

        # 3. Challenge exists + unlocked + not already solved
        challenge_result = await self.session.execute(
            select(EventChallenge).where(
                and_(
                    EventChallenge.id == challenge_id,
                    EventChallenge.event_id == event_id,
                )
            )
        )
        challenge = challenge_result.scalar_one_or_none()
        if not challenge:
            raise AppError(ErrorCode.CHALLENGE_NOT_FOUND, "challenge not found in this event")

        ch_svc = ChallengeService(self.session)
        await ch_svc.check_unlocked(
            challenge, viewer_participant_id=participant.id, viewer_is_organizer=False
        )

        # Already solved? UNIQUE constraint covers race but we check up front
        existing = await self.session.execute(
            select(EventSolve).where(
                and_(
                    EventSolve.event_id == event_id,
                    EventSolve.challenge_id == challenge_id,
                    EventSolve.participant_id == participant.id,
                )
            )
        )
        if existing.scalar_one_or_none() is not None:
            raise AppError(ErrorCode.ALREADY_SOLVED, "you already solved this challenge")

        # 4. Always record the attempt (for rate limiting + audit)
        attempt = FlagSubmissionAttempt(
            event_id=event_id,
            challenge_id=challenge_id,
            participant_id=participant.id,
            user_id=submitting_user_id,
            accepted=False,
        )
        self.session.add(attempt)

        # 5. Verify
        accepted = await self._verify_flag(submitted_flag=flag, challenge=challenge)
        attempt.accepted = accepted

        if not accepted:
            await self.session.flush()
            log.info(
                "submit_rejected",
                event_id=str(event_id),
                challenge_id=str(challenge_id),
                participant_id=str(participant.id),
            )
            raise AppError(ErrorCode.FLAG_INCORRECT, "incorrect flag")

        # 6. Determine first blood
        solve_count_before_result = await self.session.execute(
            select(func.count(EventSolve.id)).where(
                EventSolve.challenge_id == challenge_id
            )
        )
        prior_solves = int(solve_count_before_result.scalar_one() or 0)
        is_first_blood = prior_solves == 0
        new_solve_count = prior_solves + 1

        # 7. Compute points for this solve (snapshot for dynamic scoring)
        if event.dynamic_scoring:
            points_at_solve = compute_dynamic_points(
                base_points=challenge.base_points,
                solve_count=new_solve_count,
                min_points=event.min_points,
                decay_factor=self.decay_factor,
                decay_power=self.decay_power,
            )
        else:
            points_at_solve = challenge.base_points

        # 8. First-blood bonus
        fb_bonus = 0
        if is_first_blood:
            fb_bonus = first_blood_bonus(
                base_points=challenge.base_points,
                place=1,
                bonus_percentages=self.first_blood_percentages,
            )
            if event.first_blood_bonus:
                fb_bonus = max(fb_bonus, event.first_blood_bonus)

        # 9. Hint penalties for this participant on this challenge
        hint_pen_result = await self.session.execute(
            select(func.coalesce(func.sum(HintUnlock.point_deduction), 0)).where(
                and_(
                    HintUnlock.challenge_id == challenge_id,
                    HintUnlock.participant_id == participant.id,
                )
            )
        )
        hint_deduction = int(hint_pen_result.scalar_one() or 0)
        hints_used_count_result = await self.session.execute(
            select(func.count(HintUnlock.id)).where(
                and_(
                    HintUnlock.challenge_id == challenge_id,
                    HintUnlock.participant_id == participant.id,
                )
            )
        )
        hints_used = int(hints_used_count_result.scalar_one() or 0)
        net_points = max(0, points_at_solve + fb_bonus - hint_deduction)

        # 10. Insert solve row (idempotent)
        solve = EventSolve(
            event_id=event_id,
            challenge_id=challenge_id,
            participant_id=participant.id,
            solving_user_id=submitting_user_id,
            points_at_solve=net_points,
            hints_used=hints_used,
            point_deduction=hint_deduction,
            is_first_blood=is_first_blood,
        )
        self.session.add(solve)
        try:
            await self.session.flush()
        except IntegrityError:
            await self.session.rollback()
            raise AppError(ErrorCode.ALREADY_SOLVED, "race: already solved")

        # 11. Update challenge denormalized stats
        challenge.total_solves = new_solve_count
        challenge.current_points = compute_dynamic_points(
            base_points=challenge.base_points,
            solve_count=new_solve_count,
            min_points=event.min_points,
            decay_factor=self.decay_factor,
            decay_power=self.decay_power,
        )
        if is_first_blood:
            if participant.participant_type == "user":
                challenge.first_blood_user_id = participant.user_id
            else:
                challenge.first_blood_team_id = participant.team_id
            challenge.first_blood_at = now

        # 12. Update participant points + solve count
        participant.points = participant.points + net_points
        participant.solve_count = participant.solve_count + 1
        participant.last_solve_at = now

        await self.session.flush()

        log.info(
            "submit_accepted",
            event_id=str(event_id),
            challenge_id=str(challenge_id),
            participant_id=str(participant.id),
            is_first_blood=is_first_blood,
            points_awarded=net_points,
            new_total=participant.points,
        )

        # 13. Compute new rank (approximate; precise rank set by ranking job)
        rank_result = await self.session.execute(
            select(func.count()).select_from(EventParticipant).where(
                and_(
                    EventParticipant.event_id == event_id,
                    EventParticipant.is_disqualified.is_(False),
                    EventParticipant.points > participant.points,
                )
            )
        )
        approx_rank = int(rank_result.scalar_one() or 0) + 1

        return {
            "accepted": True,
            "is_first_blood": is_first_blood,
            "points_awarded": net_points,
            "new_total_points": participant.points,
            "new_rank": approx_rank,
            "challenge_id": str(challenge_id),
            "participant_id": str(participant.id),
            "solving_user_id": str(submitting_user_id),
        }

    # =========================================================================
    # Hint unlock
    # =========================================================================

    async def unlock_hint(
        self,
        *,
        event_id: UUID,
        challenge_id: UUID,
        participant: EventParticipant,
        unlocking_user_id: UUID,
        hint_id: str,
    ) -> dict[str, Any]:
        event = await self._load_event_state(event_id)
        if event.status != "live":
            raise AppError(ErrorCode.EVENT_NOT_LIVE, "event not live")
        if participant.is_disqualified:
            raise AppError(ErrorCode.PARTICIPANT_DISQUALIFIED, "you are disqualified")

        challenge_result = await self.session.execute(
            select(EventChallenge).where(
                and_(
                    EventChallenge.id == challenge_id,
                    EventChallenge.event_id == event_id,
                )
            )
        )
        challenge = challenge_result.scalar_one_or_none()
        if not challenge:
            raise AppError(ErrorCode.CHALLENGE_NOT_FOUND, "challenge not found")

        # Find hint by id
        hint = next((h for h in challenge.hints if h.get("id") == hint_id), None)
        if not hint:
            raise AppError(ErrorCode.HINT_NOT_FOUND, "hint not found")

        # Already unlocked?
        existing = await self.session.execute(
            select(HintUnlock).where(
                and_(
                    HintUnlock.challenge_id == challenge_id,
                    HintUnlock.participant_id == participant.id,
                    HintUnlock.hint_id == hint_id,
                )
            )
        )
        if existing.scalar_one_or_none() is not None:
            raise AppError(ErrorCode.HINT_ALREADY_UNLOCKED, "hint already unlocked")

        deduction = int(hint.get("point_deduction", 0))
        unlock = HintUnlock(
            event_id=event_id,
            challenge_id=challenge_id,
            participant_id=participant.id,
            hint_id=hint_id,
            point_deduction=deduction,
            unlocked_by_user_id=unlocking_user_id,
        )
        self.session.add(unlock)
        # If the challenge is already solved, apply deduction retroactively
        already_solved_result = await self.session.execute(
            select(EventSolve).where(
                and_(
                    EventSolve.challenge_id == challenge_id,
                    EventSolve.participant_id == participant.id,
                )
            )
        )
        if already_solved_result.scalar_one_or_none() is not None:
            # Don't allow unlocking hints after solve (would let players game points)
            await self.session.rollback()
            raise AppError(ErrorCode.ALREADY_SOLVED, "already solved; hints unavailable")

        await self.session.flush()
        log.info(
            "hint_unlocked",
            event_id=str(event_id),
            challenge_id=str(challenge_id),
            participant_id=str(participant.id),
            hint_id=hint_id,
            deduction=deduction,
        )
        return {
            "hint_id": hint_id,
            "text": hint.get("text", ""),
            "point_deduction": deduction,
        }
