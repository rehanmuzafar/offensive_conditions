-- =============================================================================
-- ctf — a running container per team, per challenge
-- =============================================================================
-- Challenges could already be marked `per_player`, and the image was stored and
-- validated — but nothing ever started one. The orchestrator's POST /instances
-- takes a machine *slug*: it looks the box up in the machines catalogue, checks
-- the caller's tier and generates per-instance user/root flags. None of that
-- fits a CTF challenge, which has its own flag, its own event and no entry in
-- that catalogue.
--
-- Per TEAM, not per player. A CTF team works one box together: three teammates
-- each spawning their own copy would triple the infrastructure, split their
-- effort across three hosts, and make "the box we are on" an ambiguous phrase
-- mid-event. A solo entry is a team of one and takes the same path.
--
-- One live instance per (challenge, team) is enforced by a partial unique
-- index rather than by checking first and inserting after — two teammates
-- pressing Spawn at the same moment is the normal case, not the rare one.
-- =============================================================================

CREATE TABLE IF NOT EXISTS ctf.challenge_instances (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id     uuid NOT NULL REFERENCES ctf.events(id) ON DELETE CASCADE,
    challenge_id uuid NOT NULL REFERENCES ctf.event_challenges(id) ON DELETE CASCADE,

    -- Whose instance it is. team_id for a team entry, user_id for a solo one —
    -- the same subject shape the scoreboard and adjustments use.
    team_id      uuid,
    user_id      uuid,

    --: Who pressed the button. Kept for the activity feed and for support.
    spawned_by   uuid NOT NULL,

    -- Set by the orchestrator once the container is up.
    container_ref text,
    host          text,
    port          integer,

    -- queued → running → stopped | error. Terminal states free the slot.
    status       text NOT NULL DEFAULT 'queued',
    error        text,

    expires_at   timestamptz NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    stopped_at   timestamptz,

    CONSTRAINT chk_instance_subject CHECK (
        (team_id IS NOT NULL AND user_id IS NULL)
     OR (team_id IS NULL AND user_id IS NOT NULL)
    ),
    CONSTRAINT chk_instance_status CHECK (status IN ('queued','running','stopped','error'))
);

-- "Live" means queued or running. Once stopped or errored the row stays for the
-- record but stops holding the slot.
CREATE UNIQUE INDEX IF NOT EXISTS uq_live_instance_team
    ON ctf.challenge_instances (challenge_id, team_id)
    WHERE team_id IS NOT NULL AND status IN ('queued','running');
CREATE UNIQUE INDEX IF NOT EXISTS uq_live_instance_user
    ON ctf.challenge_instances (challenge_id, user_id)
    WHERE user_id IS NOT NULL AND status IN ('queued','running');

CREATE INDEX IF NOT EXISTS idx_instances_event_live
    ON ctf.challenge_instances (event_id) WHERE status IN ('queued','running');

COMMENT ON TABLE ctf.challenge_instances IS
    'One running container per team per challenge. See migration 0016.';
