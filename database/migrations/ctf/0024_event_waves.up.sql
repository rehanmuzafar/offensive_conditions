-- =============================================================================
-- ctf — waves: staged release windows for an event's challenges
-- =============================================================================
-- Many CTFs release their challenges in rounds rather than all at once: wave 1
-- opens with fifteen, wave 2 adds fifteen more some hours later. A per-challenge
-- `unlocks_at` could express the opening, but not the closing, and an organiser
-- editing thirty rows to move one round is how mistakes happen mid-event.
--
-- A wave is therefore a first-class row that challenges point at. Moving the
-- round moves every challenge in it.
--
-- `ends_at NULL` means "runs until the event ends" — the common case, and the
-- reason the column is nullable rather than defaulting to the event's end: the
-- event's own end can be pushed out later, and a copied timestamp would then be
-- silently wrong.
-- =============================================================================

CREATE TABLE IF NOT EXISTS ctf.event_waves (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id    uuid NOT NULL REFERENCES ctf.events(id) ON DELETE CASCADE,

    name        text NOT NULL,
    --: Shown to players; 1-based and unique within the event.
    position    int  NOT NULL,

    starts_at   timestamptz NOT NULL,
    --: NULL = until the event's own end.
    ends_at     timestamptz,

    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT chk_wave_window CHECK (ends_at IS NULL OR ends_at > starts_at),
    -- Deferred, because reordering shifts a whole range of positions by one and
    -- Postgres checks a unique constraint per row as it goes: turning wave 1
    -- into wave 2 collides with the wave 2 that has not moved yet. Checking at
    -- commit lets the range settle first.
    CONSTRAINT uq_wave_position UNIQUE (event_id, position) DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS idx_event_waves_event ON ctf.event_waves (event_id, position);

-- Whether this event runs in waves at all. False keeps the old behaviour
-- exactly: every challenge is available from the start.
ALTER TABLE ctf.events
    ADD COLUMN IF NOT EXISTS has_waves BOOLEAN NOT NULL DEFAULT FALSE;

-- A challenge with no wave is open from the event's start, even on an event
-- that uses waves. That keeps a half-finished setup playable instead of
-- hiding challenges an organiser simply has not filed yet.
ALTER TABLE ctf.event_challenges
    ADD COLUMN IF NOT EXISTS wave_id uuid REFERENCES ctf.event_waves(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_event_challenges_wave ON ctf.event_challenges (wave_id);

-- -----------------------------------------------------------------------------
-- delivery_type: per_player -> per_team
-- -----------------------------------------------------------------------------
-- The value was always a misnomer. ctf.challenge_instances has been keyed on
-- (challenge, team) since 0016 and the service has always spawned one container
-- for the whole team, but the admin UI read the enum literally and told
-- organisers each player got their own box. Renaming the value is the only way
-- that stops being wrong again.
-- Both delivery checks name the old value, so both have to come off before the
-- rows can be rewritten — dropping only the IN(...) one would leave the fields
-- check to reject every updated row.
ALTER TABLE ctf.event_challenges DROP CONSTRAINT IF EXISTS chk_challenge_delivery;
ALTER TABLE ctf.event_challenges DROP CONSTRAINT IF EXISTS chk_challenge_delivery_fields;

UPDATE ctf.event_challenges SET delivery_type = 'per_team' WHERE delivery_type = 'per_player';

ALTER TABLE ctf.event_challenges
    ADD CONSTRAINT chk_challenge_delivery
    CHECK (delivery_type IN ('static','shared_host','per_team'));

ALTER TABLE ctf.event_challenges ADD CONSTRAINT chk_challenge_delivery_fields CHECK (
       (delivery_type = 'static')
    OR (delivery_type = 'shared_host' AND connection_url IS NOT NULL)
    OR (delivery_type = 'per_team'    AND image_ref IS NOT NULL)
);
