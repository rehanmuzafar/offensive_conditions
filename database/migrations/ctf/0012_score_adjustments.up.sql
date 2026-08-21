-- =============================================================================
-- ctf — organiser score adjustments
-- =============================================================================
-- Organisers need to move a team's score by hand: a penalty for sharing flags,
-- a bonus for reporting a broken challenge, a jury correction after the fact.
--
-- These are NOT written into event_participants.points, and that matters.
-- `points` is what a player earned by solving; a penalty against a team is not
-- something any one member earned or lost, and folding it in would (a) pick an
-- arbitrary member to carry it, (b) make per-player stats lie, and (c) leave no
-- record of who changed the score or why — which is exactly the thing a
-- contested result needs.
--
-- So adjustments live here and are summed alongside solve points when the
-- leaderboard is built. Every row keeps its actor and reason, and rows are
-- never edited: an adjustment that was wrong is cancelled by its opposite, so
-- the history stays readable.
-- =============================================================================

CREATE TABLE IF NOT EXISTS ctf.score_adjustments (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id     uuid NOT NULL REFERENCES ctf.events(id) ON DELETE CASCADE,

    -- Exactly one of these. A team adjustment applies to the team's whole
    -- entry; a user adjustment applies to a solo player's.
    team_id      uuid,
    user_id      uuid,

    -- Signed: positive awards, negative deducts. No zero — a no-op adjustment
    -- is noise in an audit trail.
    delta        integer NOT NULL,
    reason       text NOT NULL,

    actor_id     uuid NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT chk_adjustment_subject CHECK (
        (team_id IS NOT NULL AND user_id IS NULL)
     OR (team_id IS NULL AND user_id IS NOT NULL)
    ),
    CONSTRAINT chk_adjustment_delta CHECK (delta <> 0)
);

-- The leaderboard groups by team (or by user for solo rows), so this is the
-- shape every read uses.
CREATE INDEX IF NOT EXISTS idx_score_adjustments_event_team
    ON ctf.score_adjustments (event_id, team_id) WHERE team_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_score_adjustments_event_user
    ON ctf.score_adjustments (event_id, user_id) WHERE user_id IS NOT NULL;

COMMENT ON TABLE ctf.score_adjustments IS
    'Organiser-applied score changes, kept separate from earned points so both stay meaningful.';
