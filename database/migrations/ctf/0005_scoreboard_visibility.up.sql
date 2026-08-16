-- =============================================================================
-- ctf — organiser-controlled scoreboard visibility
-- =============================================================================
-- The leaderboard was readable by anyone who knew the event id. Organisers need
-- to decide who sees standings: some events publish them, some keep them to
-- participants, and some hide them until the event ends.
-- =============================================================================

ALTER TABLE ctf.events
    ADD COLUMN IF NOT EXISTS scoreboard_visibility TEXT NOT NULL DEFAULT 'public';

ALTER TABLE ctf.events DROP CONSTRAINT IF EXISTS chk_ctf_scoreboard_visibility;
ALTER TABLE ctf.events ADD CONSTRAINT chk_ctf_scoreboard_visibility
    CHECK (scoreboard_visibility IN ('public','participants','hidden'));

COMMENT ON COLUMN ctf.events.scoreboard_visibility IS
    'public = anyone; participants = registered players only; hidden = organisers only.';

-- Participants are shown by display name, not raw user id. Captured at
-- registration so the scoreboard needs no cross-service lookup while rendering.
ALTER TABLE ctf.event_participants
    ADD COLUMN IF NOT EXISTS display_name TEXT;
