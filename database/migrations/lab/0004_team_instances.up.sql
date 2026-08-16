-- =============================================================================
-- lab — attribute instances to a team, not just a person
-- =============================================================================
-- Every instance query keys on user_id alone (active list, duplicate-spawn
-- guard, quota count). In a team CTF one box belongs to the whole team: any
-- member should see it, reset it, and count it against the team's quota — not
-- spawn a second one because they personally have none.
--
-- Both columns are nullable and nothing reads them yet, so this is additive:
-- solo spawning is untouched until the orchestrator is taught to use them.
--   team_id        — the team from users.teams
--   participant_id — the ctf.event_participants row, when spawned inside a CTF
-- =============================================================================

ALTER TABLE lab.instances
    ADD COLUMN IF NOT EXISTS team_id        UUID,
    ADD COLUMN IF NOT EXISTS participant_id UUID,
    ADD COLUMN IF NOT EXISTS event_id       UUID;

-- The lookup the orchestrator will need: "does this team already have one?"
CREATE INDEX IF NOT EXISTS idx_instances_team_state
    ON lab.instances (team_id, state)
    WHERE team_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_instances_participant
    ON lab.instances (participant_id)
    WHERE participant_id IS NOT NULL;

COMMENT ON COLUMN lab.instances.team_id IS
    'Owning team. NULL for a solo spawn, which stays keyed by user_id.';
