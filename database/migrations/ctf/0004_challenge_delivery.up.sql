-- =============================================================================
-- ctf — explicit challenge delivery model
-- =============================================================================
-- Delivery was implied by `requires_instance` alone, which cannot express the
-- most common case in a jeopardy CTF: one shared host that every player attacks
-- at a fixed URL. That left organisers with no place to record the address, so
-- it ended up buried in the description text.
--
-- Two independent axes:
--   events.challenge_runtime  — where spawned instances live (cloud / on-site
--                               LAN / nowhere). Only affects per-player spawns.
--   event_challenges.delivery_type — how THIS challenge reaches the player.
--
-- Attachments (`files`) stay orthogonal: a pwn challenge ships a binary *and* a
-- live service, so downloads are available for every delivery type.
-- =============================================================================

ALTER TABLE ctf.events
    ADD COLUMN IF NOT EXISTS challenge_runtime TEXT NOT NULL DEFAULT 'static_only';

ALTER TABLE ctf.events DROP CONSTRAINT IF EXISTS chk_ctf_challenge_runtime;
ALTER TABLE ctf.events ADD CONSTRAINT chk_ctf_challenge_runtime
    CHECK (challenge_runtime IN ('cloud','onsite','static_only'));

COMMENT ON COLUMN ctf.events.challenge_runtime IS
    'cloud = spawn on the public-IP pool; onsite = spawn on the LAN pool; '
    'static_only = no spawning, static and shared-host challenges only.';

ALTER TABLE ctf.event_challenges
    ADD COLUMN IF NOT EXISTS delivery_type  TEXT NOT NULL DEFAULT 'static',
    ADD COLUMN IF NOT EXISTS connection_url TEXT;

ALTER TABLE ctf.event_challenges DROP CONSTRAINT IF EXISTS chk_challenge_delivery;
ALTER TABLE ctf.event_challenges ADD CONSTRAINT chk_challenge_delivery
    CHECK (delivery_type IN ('static','shared_host','per_player'));

-- A shared host is useless without an address; a spawn is useless without an
-- image. Static challenges need neither.
ALTER TABLE ctf.event_challenges DROP CONSTRAINT IF EXISTS chk_challenge_delivery_fields;
ALTER TABLE ctf.event_challenges ADD CONSTRAINT chk_challenge_delivery_fields CHECK (
       (delivery_type = 'static')
    OR (delivery_type = 'shared_host' AND connection_url IS NOT NULL)
    OR (delivery_type = 'per_player'  AND image_ref IS NOT NULL)
);

-- Backfill from the old boolean so existing rows satisfy the constraint.
UPDATE ctf.event_challenges
   SET delivery_type = CASE
        WHEN requires_instance AND image_ref IS NOT NULL THEN 'per_player'
        ELSE 'static'
   END
 WHERE delivery_type = 'static';

CREATE INDEX IF NOT EXISTS idx_event_challenges_delivery
    ON ctf.event_challenges (event_id, delivery_type);
