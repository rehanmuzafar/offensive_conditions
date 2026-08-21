"""ORM models for the ctf schema."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import (
    ARRAY,
    BigInteger,
    func,
    select,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID as PgUUID
from sqlalchemy.orm import Mapped, column_property, mapped_column, relationship

from app.db.base import Base, TimestampMixin


# =============================================================================
# Events
# =============================================================================


class Event(Base, TimestampMixin):
    __tablename__ = "events"
    __table_args__ = {"schema": "ctf"}

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    slug: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    overview_markdown: Mapped[str | None] = mapped_column(Text)

    # Format
    format: Mapped[str] = mapped_column(String(32), nullable=False, default="jeopardy")
    visibility: Mapped[str] = mapped_column(String(32), nullable=False, default="public")
    team_play: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    solo_play: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    max_team_size: Mapped[int | None] = mapped_column(Integer, default=4)

    # Timing
    registration_starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    registration_ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    scoreboard_freeze_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Scoring
    dynamic_scoring: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    min_points: Mapped[int] = mapped_column(Integer, nullable=False, default=50)
    first_blood_bonus: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Access
    required_tier: Mapped[str] = mapped_column(String(16), nullable=False, default="free")

    # Who may read the scoreboard: public | participants | hidden.
    scoreboard_visibility: Mapped[str] = mapped_column(
        Text, nullable=False, default="public", server_default="public"
    )

    # Where per-player spawns are provisioned: cloud (public IPs), onsite (LAN),
    # or static_only (no spawning at all).
    challenge_runtime: Mapped[str] = mapped_column(
        Text, nullable=False, default="static_only", server_default="static_only"
    )

    # Paid events: 0 means free. Money in minor units to avoid float drift.
    entry_fee_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    currency: Mapped[str] = mapped_column(Text, nullable=False, default="USD", server_default="USD")
    refund_policy: Mapped[str | None] = mapped_column(Text)
    invitation_only: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    invitation_code: Mapped[str | None] = mapped_column(Text)
    max_participants: Mapped[int | None] = mapped_column(Integer)

    # Prizes
    prize_pool: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, default=list, server_default="[]"
    )

    # Status
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft")

    # --- Writeups ----------------------------------------------------------
    #: How far down the board the writeup requirement reaches. NULL = nobody.
    writeup_required_top_n: Mapped[int | None] = mapped_column(Integer)
    writeup_deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # --- Pause -------------------------------------------------------------
    # Not a status: the event is still live while paused, it is simply not
    # accepting play. See migration 0010 for why the two are kept apart.
    paused_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    pause_starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    pause_ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    pause_reason: Mapped[str | None] = mapped_column(Text)

    def paused_at_time(self, moment: datetime) -> bool:
        """Manual pause, or inside a scheduled window, at a given instant."""
        if self.paused_at is not None:
            return True
        if self.pause_starts_at is None or self.pause_ends_at is None:
            return False
        return self.pause_starts_at <= moment < self.pause_ends_at

    @property
    def is_paused(self) -> bool:
        """Whether play is stopped right now.

        A property, not a method: `EventRead` reads this off the ORM object with
        `from_attributes`, and a method would serialise as the bound function
        rather than the answer.

        Computed rather than stored so a scheduled pause needs nothing to switch
        it on — the window simply becomes true when the clock enters it.
        """
        return self.paused_at_time(datetime.now(timezone.utc))

    cover_image_url: Mapped[str | None] = mapped_column(Text)
    rules_markdown: Mapped[str | None] = mapped_column(Text)
    sponsor_info: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )

    # Stats
    total_registered: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_teams: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_by: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSONB, nullable=False, default=dict, server_default="{}"
    )


class EventChallenge(Base, TimestampMixin):
    __tablename__ = "event_challenges"
    __table_args__ = {"schema": "ctf"}

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    event_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("ctf.events.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str] = mapped_column(String(64), nullable=False)
    difficulty: Mapped[str | None] = mapped_column(String(16))
    description: Mapped[str] = mapped_column(Text, nullable=False)

    # Scoring
    base_points: Mapped[int] = mapped_column(Integer, nullable=False)
    current_points: Mapped[int] = mapped_column(Integer, nullable=False)

    # Lab config
    requires_instance: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # How this challenge reaches the player. Orthogonal to `files`, which are
    # available for every delivery type.
    delivery_type: Mapped[str] = mapped_column(
        Text, nullable=False, default="static", server_default="static"
    )
    # Address players attack for a shared-host challenge.
    connection_url: Mapped[str | None] = mapped_column(Text)
    image_ref: Mapped[str | None] = mapped_column(Text)
    files: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, default=list, server_default="[]"
    )

    # Flag
    static_flag_hash: Mapped[str | None] = mapped_column(Text)
    flag_pattern: Mapped[str | None] = mapped_column(Text)

    # Gating
    unlocks_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    requires_solving_ids: Mapped[list[UUID]] = mapped_column(
        ARRAY(PgUUID(as_uuid=True)), nullable=False, default=list, server_default="{}"
    )

    # Hints (array of {id, text, point_deduction})
    hints: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, default=list, server_default="[]"
    )

    # Stats
    total_solves: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    first_blood_user_id: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))
    first_blood_team_id: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))
    first_blood_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_hidden: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


# =============================================================================
# Participants
# =============================================================================


class EventParticipant(Base):
    __tablename__ = "event_participants"
    __table_args__ = (
        UniqueConstraint("event_id", "user_id", name="uq_event_user"),
        # No unique (event_id, team_id): registration is per player, so several
        # teammates hold rows for the same team in one event (migration 0009).
        {"schema": "ctf"},
    )

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    event_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("ctf.events.id", ondelete="CASCADE"),
        nullable=False,
    )
    participant_type: Mapped[str] = mapped_column(String(16), nullable=False)  # user|team
    user_id: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))
    team_id: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))
    team_name_at_event: Mapped[str | None] = mapped_column(String(200))

    # Stats
    points: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    solve_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_solve_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    rank: Mapped[int | None] = mapped_column(Integer)
    is_disqualified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    disqualification_reason: Mapped[str | None] = mapped_column(Text)
    registered_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="NOW()"
    )

    # Captured at registration so the scoreboard can show a name instead of a
    # raw user id without a cross-service lookup on every render.
    display_name: Mapped[str | None] = mapped_column(Text)

    # Paid events: registration is only complete once payment settles.
    # 'not_required' is the free-event default and keeps existing rows valid.
    payment_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="not_required", server_default="not_required"
    )
    amount_paid_cents: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    payment_currency: Mapped[str | None] = mapped_column(Text)
    payment_provider: Mapped[str | None] = mapped_column(Text)
    payment_reference: Mapped[str | None] = mapped_column(Text)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class EventSolve(Base):
    __tablename__ = "event_solves"
    __table_args__ = (
        UniqueConstraint(
            "event_id", "challenge_id", "participant_id", name="uq_event_challenge_participant"
        ),
        {"schema": "ctf"},
    )

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    event_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("ctf.events.id", ondelete="CASCADE"),
        nullable=False,
    )
    challenge_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("ctf.event_challenges.id", ondelete="CASCADE"),
        nullable=False,
    )
    participant_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("ctf.event_participants.id", ondelete="CASCADE"),
        nullable=False,
    )
    solving_user_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    points_at_solve: Mapped[int] = mapped_column(Integer, nullable=False)
    hints_used: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    point_deduction: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_first_blood: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    solved_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="NOW()"
    )


class ChallengeProgress(Base, TimestampMixin):
    """What a team has said about a challenge: who owns it and how it is going."""

    __tablename__ = "challenge_progress"
    __table_args__ = (
        UniqueConstraint("challenge_id", "participant_id", name="uq_progress_challenge_participant"),
        {"schema": "ctf"},
    )

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    event_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("ctf.events.id", ondelete="CASCADE"), nullable=False
    )
    challenge_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("ctf.event_challenges.id", ondelete="CASCADE"),
        nullable=False,
    )
    participant_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("ctf.event_participants.id", ondelete="CASCADE"),
        nullable=False,
    )

    status: Mapped[str] = mapped_column(
        Text, nullable=False, default="untouched", server_default="untouched"
    )
    note: Mapped[str | None] = mapped_column(Text)

    assigned_to_user_id: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))
    assigned_by_user_id: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))
    assigned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    updated_by_user_id: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))


class ChatMessage(Base, TimestampMixin):
    """A team's chat. Scoped by participant, same as challenge progress."""

    __tablename__ = "chat_messages"
    __table_args__ = ({"schema": "ctf"},)

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    event_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("ctf.events.id", ondelete="CASCADE"), nullable=False
    )
    participant_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("ctf.event_participants.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    # Captured at send time so rendering a long thread needs no user lookups.
    username: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")

    body: Mapped[str] = mapped_column(Text, nullable=False)
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class EventWriteup(Base):
    """A team's writeup for one event.

    Draft until the captain turns it in. A draft can be replaced or deleted —
    the captain is fixing a mistake, not keeping versions — so replacing
    overwrites this row rather than adding another, which is also what keeps
    "have they submitted?" a question with one answer.
    """

    __tablename__ = "event_writeups"
    __table_args__ = {"schema": "ctf"}

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    event_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("ctf.events.id", ondelete="CASCADE"),
        nullable=False,
    )
    team_id: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))
    user_id: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))

    filename: Mapped[str] = mapped_column(Text, nullable=False)
    content_type: Mapped[str] = mapped_column(Text, nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    #: Object key in the private bucket. Never handed to a browser directly —
    #: the service streams it so authorisation is checked on every read.
    storage_key: Mapped[str] = mapped_column(Text, nullable=False)

    status: Mapped[str] = mapped_column(Text, nullable=False, default="draft")
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    uploaded_by: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="NOW()"
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="NOW()"
    )


class RankPin(Base):
    """A position an organiser fixed by hand.

    Not `EventParticipant.rank`: that column is rebuilt from points every thirty
    seconds by recompute_ranks, so an override written there would work until
    the next tick and then disappear.

    A pin breaks the board's promise that more points finishes higher, and
    nothing here can change that — so every pin records who set it and why, and
    the API marks the row as pinned rather than letting the board contradict
    itself in silence. See migration 0015.
    """

    __tablename__ = "rank_pins"
    __table_args__ = {"schema": "ctf"}

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    event_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("ctf.events.id", ondelete="CASCADE"),
        nullable=False,
    )
    team_id: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))
    user_id: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))

    #: 1-based, as displayed. Past the end of the board it settles at the end.
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str | None] = mapped_column(Text)

    actor_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="NOW()"
    )


class ScoreAdjustment(Base):
    """An organiser moving a score by hand.

    Kept out of EventParticipant.points on purpose: `points` is what a player
    earned by solving, and a team penalty is not something any one member
    earned. Storing it here also keeps the actor and the reason, which is the
    part that matters when a result is contested. See migration 0012.
    """

    __tablename__ = "score_adjustments"
    __table_args__ = {"schema": "ctf"}

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    event_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("ctf.events.id", ondelete="CASCADE"),
        nullable=False,
    )
    # Exactly one of these; the check constraint enforces it.
    team_id: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))
    user_id: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))

    #: Signed. Positive awards, negative deducts; zero is rejected.
    delta: Mapped[int] = mapped_column(Integer, nullable=False)
    #: Optional for a quiet correction; required when the change is published.
    reason: Mapped[str | None] = mapped_column(Text)
    #: Show this adjustment and its reason on the public scoreboard. The points
    #: count either way — this only decides whether the board explains them.
    visible: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    actor_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="NOW()"
    )


# The event payload carried no challenge count, so every card rendered
# "0 challenges" next to a populated challenge list. A column_property keeps it
# correct for both the list and the detail endpoint without touching callers.
Event.challenge_count = column_property(
    select(func.count(EventChallenge.id))
    .where(EventChallenge.event_id == Event.id)
    .correlate_except(EventChallenge)
    .scalar_subquery()
)

class ChallengeInstance(Base):
    """A container running for one team, for one challenge.

    Per team, not per player: a CTF team works one box together. See migration
    ctf/0016 for why, and for why the one-live-instance rule is a partial
    unique index rather than a check-then-insert.
    """

    __tablename__ = "challenge_instances"
    __table_args__ = ({"schema": "ctf"},)

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    event_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("ctf.events.id", ondelete="CASCADE"), nullable=False
    )
    challenge_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("ctf.event_challenges.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Exactly one is set — team entry or solo entry.
    team_id: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))
    user_id: Mapped[UUID | None] = mapped_column(PgUUID(as_uuid=True))
    spawned_by: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    # Captured at spawn time so the panel needs no cross-service lookup to
    # credit a teammate by name. See migration ctf/0017.
    spawned_by_name: Mapped[str | None] = mapped_column(Text)

    container_ref: Mapped[str | None] = mapped_column(Text)
    host: Mapped[str | None] = mapped_column(Text)
    port: Mapped[int | None] = mapped_column(Integer)

    status: Mapped[str] = mapped_column(
        Text, nullable=False, default="queued", server_default="queued"
    )
    error: Mapped[str | None] = mapped_column(Text)

    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="NOW()"
    )
    stopped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
