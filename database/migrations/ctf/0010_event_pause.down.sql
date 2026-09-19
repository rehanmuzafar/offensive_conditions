ALTER TABLE ctf.events DROP CONSTRAINT IF EXISTS chk_event_pause_window;

ALTER TABLE ctf.events
    DROP COLUMN IF EXISTS pause_reason,
    DROP COLUMN IF EXISTS pause_ends_at,
    DROP COLUMN IF EXISTS pause_starts_at,
    DROP COLUMN IF EXISTS paused_at;
