DROP INDEX IF EXISTS ctf.idx_event_challenges_delivery;
ALTER TABLE ctf.event_challenges
    DROP CONSTRAINT IF EXISTS chk_challenge_delivery_fields,
    DROP CONSTRAINT IF EXISTS chk_challenge_delivery,
    DROP COLUMN IF EXISTS delivery_type,
    DROP COLUMN IF EXISTS connection_url;
ALTER TABLE ctf.events
    DROP CONSTRAINT IF EXISTS chk_ctf_challenge_runtime,
    DROP COLUMN IF EXISTS challenge_runtime;
