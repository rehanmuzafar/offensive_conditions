DROP INDEX IF EXISTS lab.idx_instances_team_state;
DROP INDEX IF EXISTS lab.idx_instances_participant;
ALTER TABLE lab.instances
    DROP COLUMN IF EXISTS team_id,
    DROP COLUMN IF EXISTS participant_id,
    DROP COLUMN IF EXISTS event_id;
