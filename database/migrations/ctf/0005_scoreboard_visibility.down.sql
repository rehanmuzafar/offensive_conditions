ALTER TABLE ctf.event_participants DROP COLUMN IF EXISTS display_name;
ALTER TABLE ctf.events
    DROP CONSTRAINT IF EXISTS chk_ctf_scoreboard_visibility,
    DROP COLUMN IF EXISTS scoreboard_visibility;
