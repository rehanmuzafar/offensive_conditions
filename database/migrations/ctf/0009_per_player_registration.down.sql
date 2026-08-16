ALTER TABLE ctf.event_participants ALTER COLUMN user_id DROP NOT NULL;
DROP INDEX IF EXISTS ctf.idx_participants_event_team;
ALTER TABLE ctf.event_participants ADD CONSTRAINT uq_event_team UNIQUE (event_id, team_id);
