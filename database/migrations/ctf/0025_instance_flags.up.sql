-- =============================================================================
-- ctf — per-instance flags
-- =============================================================================
-- Until now every team solving a spawning challenge submitted the same string:
-- verification hashed the submission and compared it to the challenge's single
-- static_flag_hash. One team could hand the flag to another and it worked, which
-- defeats the point of giving each team its own box.
--
-- The flag now belongs to the instance. A team gets its own, and it dies with
-- the container: stop and respawn and the old one stops verifying, because the
-- row carrying its hash is no longer the live one.
--
-- Only the hash is stored. The raw flag is written into the container's
-- environment and is never returned to the player — finding it is the
-- challenge. It exists in exactly one place they can reach, and they have to
-- earn their way there.
--
-- static_flag_hash stays on the challenge and stays authoritative for
-- challenges that do not spawn. The two coexist: a challenge opts in by having
-- dynamic_flag set, and the images that bake their flag in keep working
-- untouched.
-- =============================================================================

ALTER TABLE ctf.challenge_instances
    ADD COLUMN IF NOT EXISTS flag_hash text;

COMMENT ON COLUMN ctf.challenge_instances.flag_hash IS
    'sha256 of this instance''s flag. NULL when the challenge uses a static flag.';

-- Opt-in per challenge. Off by default so nothing that works today changes
-- behaviour: an image with a baked-in flag would otherwise start rejecting the
-- only flag it knows how to serve.
ALTER TABLE ctf.event_challenges
    ADD COLUMN IF NOT EXISTS dynamic_flag BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN ctf.event_challenges.dynamic_flag IS
    'Generate a fresh flag per spawned instance and pass it in as CTF_FLAG. Requires the image to read it rather than bake one in.';

-- A dynamic flag only means anything for a challenge that actually spawns
-- something to put it in.
ALTER TABLE ctf.event_challenges DROP CONSTRAINT IF EXISTS chk_dynamic_flag_needs_instance;
ALTER TABLE ctf.event_challenges
    ADD CONSTRAINT chk_dynamic_flag_needs_instance
    CHECK (NOT dynamic_flag OR delivery_type = 'per_team');

-- Verification looks up the submitting team's live instance for the challenge;
-- 0016's partial unique index already covers (challenge_id, team_id) while
-- live, so this only needs to make the hash reachable from that row.
CREATE INDEX IF NOT EXISTS idx_challenge_instances_flag
    ON ctf.challenge_instances (challenge_id, team_id)
    WHERE flag_hash IS NOT NULL;
