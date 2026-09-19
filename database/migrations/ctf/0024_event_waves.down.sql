ALTER TABLE ctf.event_challenges DROP CONSTRAINT IF EXISTS chk_challenge_delivery;
ALTER TABLE ctf.event_challenges DROP CONSTRAINT IF EXISTS chk_challenge_delivery_fields;
UPDATE ctf.event_challenges SET delivery_type = 'per_player' WHERE delivery_type = 'per_team';
ALTER TABLE ctf.event_challenges
    ADD CONSTRAINT chk_challenge_delivery
    CHECK (delivery_type IN ('static','shared_host','per_player'));
ALTER TABLE ctf.event_challenges ADD CONSTRAINT chk_challenge_delivery_fields CHECK (
       (delivery_type = 'static')
    OR (delivery_type = 'shared_host' AND connection_url IS NOT NULL)
    OR (delivery_type = 'per_player'  AND image_ref IS NOT NULL)
);

DROP INDEX IF EXISTS ctf.idx_event_challenges_wave;
ALTER TABLE ctf.event_challenges DROP COLUMN IF EXISTS wave_id;
ALTER TABLE ctf.events DROP COLUMN IF EXISTS has_waves;
DROP INDEX IF EXISTS ctf.idx_event_waves_event;
DROP TABLE IF EXISTS ctf.event_waves;
