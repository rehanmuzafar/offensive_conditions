DROP INDEX IF EXISTS ctf.idx_challenge_instances_flag;
ALTER TABLE ctf.event_challenges DROP CONSTRAINT IF EXISTS chk_dynamic_flag_needs_instance;
ALTER TABLE ctf.event_challenges DROP COLUMN IF EXISTS dynamic_flag;
ALTER TABLE ctf.challenge_instances DROP COLUMN IF EXISTS flag_hash;
