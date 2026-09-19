"""Event challenge service: CRUD, listing with locked-state, prerequisites."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, ErrorCode
from app.core.logging import get_logger
from app.models import Event, EventChallenge, EventSolve, EventWave, HintUnlock
from app.schemas import EventChallengeCreate, EventChallengeUpdate

log = get_logger("challenges")


class ChallengeService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(self, challenge_id: UUID) -> EventChallenge:
        result = await self.session.execute(
            select(EventChallenge).where(EventChallenge.id == challenge_id)
        )
        ch = result.scalar_one_or_none()
        if not ch:
            raise AppError(ErrorCode.CHALLENGE_NOT_FOUND, "challenge not found")
        return ch

    async def assert_may_read_challenges(
        self,
        event_id: UUID,
        *,
        viewer_participant_id: UUID | None,
        viewer_is_organizer: bool,
    ) -> Event:
        """Gate on the event itself: is this viewer allowed to see its challenges?

        Lives here rather than in a handler because it has to hold for every way
        in. It used to be inline in list_for_event only, so fetching a challenge
        by its own id skipped all of it — and challenge ids are not secret, they
        travel on the public activity feed. Any account could read a paid or
        invite-only event's challenges by asking for them one at a time.

        Returns the event so callers do not load it twice.
        """
        event_result = await self.session.execute(select(Event).where(Event.id == event_id))
        event = event_result.scalar_one_or_none()
        if not event:
            raise AppError(ErrorCode.EVENT_NOT_FOUND, "event not found")

        if viewer_is_organizer:
            return event

        # Challenges are visible only while the event is actually running —
        # not before it starts, and not after it ends. Organisers always see
        # them so they can prepare and review.
        if event.status != "live":
            msg = (
                "this event has ended"
                if event.status in ("ended", "archived")
                else "challenges unlock when the event starts"
            )
            raise AppError(ErrorCode.EVENT_NOT_LIVE, msg)

        # …and only if they actually joined. Without this anyone with an account
        # could read every challenge of a running event — descriptions, hints,
        # attachment links — without registering, which leaks the whole CTF to
        # non-participants and to anyone who missed the registration window.
        if viewer_participant_id is None:
            raise AppError(
                ErrorCode.NOT_REGISTERED,
                "register for the event to see its challenges",
            )
        return event

    @staticmethod
    def is_withheld(
        challenge: EventChallenge,
        *,
        wave_state: str | None,
        solved_ids: set[UUID],
        now: datetime,
    ) -> bool:
        """Whether this challenge's content must be kept back from a player.

        The list endpoint returns every challenge so the board can show what is
        coming, but a challenge that has not been released yet must not hand out
        its description, attachments or hints — that is what let a team start on
        a later wave the moment an event went live.

        A *closed* wave is deliberately not withheld: those challenges were
        open, were solved, and the board still has to show what happened. Only
        content that was never released is held back.

        Kept as a pure function so the rule can be tested without a request.
        """
        if challenge.unlocks_at is not None and now < challenge.unlocks_at:
            return True
        if wave_state == "upcoming":
            return True
        return any(req not in solved_ids for req in (challenge.requires_solving_ids or []))

    async def list_for_event(
        self,
        event_id: UUID,
        *,
        viewer_participant_id: UUID | None,
        viewer_is_organizer: bool,
    ) -> tuple[list[EventChallenge], set[UUID]]:
        """List challenges visible to the viewer + the set of IDs they've solved."""
        await self.assert_may_read_challenges(
            event_id,
            viewer_participant_id=viewer_participant_id,
            viewer_is_organizer=viewer_is_organizer,
        )

        stmt = (
            select(EventChallenge)
            .where(EventChallenge.event_id == event_id)
            .order_by(EventChallenge.category.asc(), EventChallenge.sort_order.asc())
        )
        if not viewer_is_organizer:
            stmt = stmt.where(EventChallenge.is_hidden.is_(False))

        result = await self.session.execute(stmt)
        challenges = list(result.scalars().all())

        # Resolve solved set for the viewer
        solved_ids: set[UUID] = set()
        if viewer_participant_id:
            solved_result = await self.session.execute(
                select(EventSolve.challenge_id).where(
                    EventSolve.participant_id == viewer_participant_id
                )
            )
            solved_ids = {row[0] for row in solved_result}

        return challenges, solved_ids

    async def create(
        self, event_id: UUID, *, data: EventChallengeCreate
    ) -> EventChallenge:
        # Verify event exists + still editable (before live)
        event_result = await self.session.execute(select(Event).where(Event.id == event_id))
        event = event_result.scalar_one_or_none()
        if not event:
            raise AppError(ErrorCode.EVENT_NOT_FOUND, "event not found")
        # Organisers release challenges mid-event all the time, so `live` is
        # allowed. A finished event stays frozen — adding to it would rewrite a
        # scoreboard people have already been ranked on.
        if event.status in ("ended", "archived"):
            raise AppError(
                ErrorCode.FORBIDDEN, "this event has ended; challenges are frozen"
            )

        # Delivery consistency — the DB has matching CHECK constraints, but a
        # clear 400 here beats a constraint violation surfacing as a 500.
        if data.delivery_type == "shared_host" and not data.connection_url:
            raise AppError(
                ErrorCode.VALIDATION,
                "a shared-host challenge needs the address players connect to",
            )
        if data.delivery_type == "per_team":
            if not data.image_ref:
                raise AppError(
                    ErrorCode.VALIDATION, "a per-team challenge needs a container image"
                )
            if event.challenge_runtime == "static_only":
                raise AppError(
                    ErrorCode.VALIDATION,
                    "this event has no runtime configured — set the event to run "
                    "challenges on cloud or on-site before adding a spawning challenge",
                )

        if data.dynamic_flag and data.delivery_type != "per_team":
            raise AppError(
                ErrorCode.VALIDATION,
                "a per-instance flag needs something to put it in — set delivery to per-team spawn",
            )

        if data.wave_id is not None:
            await self._check_wave_belongs(event_id, data.wave_id)

        body = data.model_dump()
        # requires_instance is derived, so the two can never disagree.
        body["requires_instance"] = data.delivery_type == "per_team"
        body["files"] = [
            f if isinstance(f, dict) else f.model_dump() for f in body.get("files", [])
        ]
        body["hints"] = [
            h if isinstance(h, dict) else h.model_dump() for h in body.get("hints", [])
        ]

        challenge = EventChallenge(
            event_id=event_id,
            current_points=body["base_points"],
            **body,
        )
        self.session.add(challenge)
        await self.session.flush()
        log.info(
            "challenge_created", event_id=str(event_id), challenge_id=str(challenge.id)
        )
        return challenge

    async def delete(self, challenge_id: UUID, *, event_id: UUID) -> None:
        """Remove a challenge from a given event.

        Refused once an event has ended, for the same reason edits are: teams
        have already been scored against this challenge and the final standings
        must stay explicable. While an event is live it is allowed — a broken
        challenge is worse than a missing one, and organizers do pull them
        mid-CTF.
        """
        challenge = await self.get(challenge_id)

        # Checked first. Deleting and *then* discovering the caller used another
        # event's URL would mean the row is already gone, leaving correctness to
        # whether the request happens to roll back.
        if challenge.event_id != event_id:
            raise AppError(ErrorCode.CHALLENGE_NOT_FOUND, "challenge not in this event")

        event = await self.session.get(Event, challenge.event_id)

        if event and event.status in ("ended", "archived"):
            raise AppError(
                ErrorCode.FORBIDDEN,
                "cannot delete a challenge after the event has ended",
            )

        await self.session.delete(challenge)
        await self.session.flush()
        log.info("challenge_deleted", challenge_id=str(challenge_id), event_id=str(event_id))

    async def update(
        self, challenge_id: UUID, *, data: EventChallengeUpdate
    ) -> EventChallenge:
        challenge = await self.get(challenge_id)
        event = await self.session.get(Event, challenge.event_id)
        # A live event stays editable — fixing a broken description or a wrong
        # flag mid-CTF is normal. Once ended, everything freezes so the final
        # standings cannot be altered after the fact.
        if event and event.status in ("ended", "archived"):
            allowed = {"sort_order", "is_hidden"}
            requested = set(data.model_dump(exclude_unset=True).keys())
            disallowed = requested - allowed
            if disallowed:
                raise AppError(
                    ErrorCode.FORBIDDEN,
                    f"cannot edit {sorted(disallowed)} after the event has ended",
                )

        body = data.model_dump(exclude_unset=True)
        # clear_wave is a flag, not a column — None on wave_id already means
        # "field omitted", so taking a challenge out of its wave needs its own
        # signal.
        clear_wave = bool(body.pop("clear_wave", False))
        if clear_wave:
            body["wave_id"] = None
        elif body.get("wave_id") is not None:
            await self._check_wave_belongs(challenge.event_id, body["wave_id"])
        elif "wave_id" in body:
            # Sent as null without clear_wave: treat as "leave it alone" rather
            # than silently unfiling the challenge.
            body.pop("wave_id")

        # Keep the derived flag in step when delivery changes, and re-check the
        # same consistency rules create() enforces.
        if "delivery_type" in body and body["delivery_type"] is not None:
            new_delivery = body["delivery_type"]
            body["requires_instance"] = new_delivery == "per_team"
            url = body.get("connection_url", challenge.connection_url)
            img = body.get("image_ref", challenge.image_ref)
            if new_delivery == "shared_host" and not url:
                raise AppError(
                    ErrorCode.VALIDATION,
                    "a shared-host challenge needs the address players connect to",
                )
            if new_delivery == "per_team":
                if not img:
                    raise AppError(
                        ErrorCode.VALIDATION, "a per-team challenge needs a container image"
                    )
                if event and event.challenge_runtime == "static_only":
                    raise AppError(
                        ErrorCode.VALIDATION,
                        "this event has no runtime configured — set it to cloud or on-site first",
                    )

        # Checked against the delivery the challenge will *have*, not the one it
        # had: flipping a spawning challenge back to static in the same request
        # would otherwise leave a dynamic flag with nowhere to live.
        final_delivery = body.get("delivery_type") or challenge.delivery_type
        final_dynamic = body.get("dynamic_flag")
        if final_dynamic is None:
            final_dynamic = challenge.dynamic_flag
        if final_dynamic and final_delivery != "per_team":
            raise AppError(
                ErrorCode.VALIDATION,
                "a per-instance flag needs something to put it in — set delivery to per-team spawn",
            )

        if "files" in body and body["files"] is not None:
            body["files"] = [
                f if isinstance(f, dict) else f.model_dump() for f in body["files"]
            ]
        if "hints" in body and body["hints"] is not None:
            body["hints"] = [
                h if isinstance(h, dict) else h.model_dump() for h in body["hints"]
            ]
        for k, v in body.items():
            setattr(challenge, k, v)
        await self.session.flush()
        return challenge

    # =========================================================================
    # Gating checks (used at submit + listing time)
    # =========================================================================

    async def check_unlocked(
        self,
        challenge: EventChallenge,
        *,
        viewer_participant_id: UUID | None,
        viewer_is_organizer: bool,
    ) -> None:
        """Raise CHALLENGE_LOCKED / CHALLENGE_PREREQ_MISSING if not unlocked."""
        if viewer_is_organizer:
            return
        await self._check_wave_open(challenge)
        if challenge.unlocks_at:
            now = datetime.now(timezone.utc)
            if now < challenge.unlocks_at:
                raise AppError(
                    ErrorCode.CHALLENGE_LOCKED,
                    f"unlocks at {challenge.unlocks_at.isoformat()}",
                )
        if challenge.requires_solving_ids and viewer_participant_id:
            solved_result = await self.session.execute(
                select(EventSolve.challenge_id).where(
                    and_(
                        EventSolve.participant_id == viewer_participant_id,
                        EventSolve.challenge_id.in_(challenge.requires_solving_ids),
                    )
                )
            )
            solved = {row[0] for row in solved_result}
            missing = [
                str(req) for req in challenge.requires_solving_ids if req not in solved
            ]
            if missing:
                raise AppError(
                    ErrorCode.CHALLENGE_PREREQ_MISSING,
                    "prerequisite challenges not yet solved",
                    details={"missing": missing},
                )

    async def _check_wave_belongs(self, event_id: UUID, wave_id: UUID) -> None:
        """A challenge may only point at a wave of its own event."""
        found = (
            await self.session.execute(
                select(EventWave.id).where(
                    EventWave.id == wave_id, EventWave.event_id == event_id
                )
            )
        ).scalar_one_or_none()
        if not found:
            raise AppError(ErrorCode.VALIDATION, "that wave belongs to another event")

    async def _check_wave_open(self, challenge: EventChallenge) -> None:
        """Refuse a challenge whose release wave has not opened, or has shut.

        A challenge with no wave is always open — that is the deliberate escape
        hatch for challenges an organiser has not filed into a round yet.
        """
        if challenge.wave_id is None:
            return
        row = (
            await self.session.execute(
                select(EventWave, Event.ends_at)
                .join(Event, Event.id == EventWave.event_id)
                .where(EventWave.id == challenge.wave_id)
            )
        ).first()
        if row is None:
            return
        wave, event_ends_at = row
        state = wave.state(event_ends_at)
        if state == "upcoming":
            raise AppError(
                ErrorCode.CHALLENGE_LOCKED,
                f"{wave.name} opens at {wave.starts_at.isoformat()}",
            )
        if state == "closed":
            raise AppError(
                ErrorCode.CHALLENGE_LOCKED,
                f"{wave.name} closed at {wave.closes_at(event_ends_at).isoformat()}",
            )

    async def unlocked_hint_ids(
        self, event_id: UUID, participant_id: UUID
    ) -> dict[UUID, set[str]]:
        """Hints this participant has already paid for, keyed by challenge."""
        rows = await self.session.execute(
            select(HintUnlock.challenge_id, HintUnlock.hint_id).where(
                and_(
                    HintUnlock.event_id == event_id,
                    HintUnlock.participant_id == participant_id,
                )
            )
        )
        out: dict[UUID, set[str]] = {}
        for challenge_id, hint_id in rows:
            out.setdefault(challenge_id, set()).add(hint_id)
        return out

    def hint_summaries(
        self, challenge: EventChallenge, unlocked: set[str] | None = None
    ) -> list[dict[str, Any]]:
        """Hint id + cost, plus the text of the ones this viewer has unlocked.

        Withholding the text until it is paid for is the point of hints. Never
        handing it back afterwards is not: unlocking wrote a row, deducted the
        points and returned the text exactly once, and a reload lost it for
        good — with the endpoint answering 409 on a second attempt, so the
        player had paid for something they could no longer read.
        """
        seen = unlocked or set()
        summaries: list[dict[str, Any]] = []
        for h in challenge.hints:
            hint_id = h["id"]
            is_unlocked = hint_id in seen
            row: dict[str, Any] = {
                "id": hint_id,
                "point_deduction": h.get("point_deduction", 0),
                "unlocked": is_unlocked,
            }
            if is_unlocked:
                row["text"] = h.get("text")
            summaries.append(row)
        return summaries
