-- =============================================================================
-- ctf — remember the team's name on its entry
-- =============================================================================
-- Needed so settling a payment can put the captain into the event without
-- another round trip to user-svc. A webhook arrives with no caller and no
-- bearer token, so anything it needs about the team has to already be here.
--
-- Captured when the intent is created, which is the one moment we have both a
-- verified captain and the team's details in hand.
-- =============================================================================

ALTER TABLE ctf.event_team_entries
    ADD COLUMN IF NOT EXISTS team_name TEXT;
