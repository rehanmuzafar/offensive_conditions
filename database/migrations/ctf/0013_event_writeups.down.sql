DROP TABLE IF EXISTS ctf.event_writeups;

ALTER TABLE ctf.events DROP CONSTRAINT IF EXISTS chk_event_writeup_top_n;
ALTER TABLE ctf.events
    DROP COLUMN IF EXISTS writeup_deadline,
    DROP COLUMN IF EXISTS writeup_required_top_n;
