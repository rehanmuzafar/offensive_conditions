-- =============================================================================
-- ctf — every registration is a person, optionally representing a team
-- =============================================================================
-- Registration used to create ONE row per team with user_id NULL, so the whole
-- squad was entered by whoever clicked first. That is wrong: a player joins an
-- event themselves, and on a team event they pick which of their teams they are
-- playing for. Two teammates therefore produce two rows sharing a team_id.
--
-- Consequences of the old shape that this fixes:
--   • no record of who actually turned up, or when
--   • per-player stats (flags, points) had nowhere to live
--   • a member could not join if the captain had not registered the team
--
-- user_id becomes mandatory; team_id becomes the "playing for" link.
-- =============================================================================

-- A team-registered row has no user to attribute it to; the captain re-registers
-- under the new model.
DELETE FROM ctf.event_participants WHERE user_id IS NULL;

ALTER TABLE ctf.event_participants ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE ctf.event_participants DROP CONSTRAINT IF EXISTS chk_event_participant_id;
ALTER TABLE ctf.event_participants ADD CONSTRAINT chk_event_participant_id
    CHECK (participant_type = 'user' OR (participant_type = 'team' AND team_id IS NOT NULL));

-- One row per person per event. The old uq_event_team stopped a second member
-- of the same team from registering at all.
ALTER TABLE ctf.event_participants DROP CONSTRAINT IF EXISTS uq_event_team;

CREATE INDEX IF NOT EXISTS idx_participants_event_team
    ON ctf.event_participants (event_id, team_id)
    WHERE team_id IS NOT NULL;

COMMENT ON COLUMN ctf.event_participants.team_id IS
    'The team this player represents in this event. NULL on a solo event.';
