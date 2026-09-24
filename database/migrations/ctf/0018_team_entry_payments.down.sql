-- Reverses 0018. The per-participant payment columns from 0003 were never
-- touched, so dropping this table returns the schema exactly to where it was.
DROP TABLE IF EXISTS ctf.event_team_entries;
