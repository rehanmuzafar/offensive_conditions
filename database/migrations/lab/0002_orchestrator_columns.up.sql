-- =============================================================================
-- lab — align lab.instances with the orchestrator's data access layer
-- =============================================================================
-- services/orchestrator/internal/repository/postgres.go reads and writes a
-- different column set than 0001 created (machine_slug, state, ip_address,
-- vlan_tag, flag_user_hash, … ). Every orchestrator query therefore failed with
-- `column "machine_slug" does not exist`, and the reaper and health checker
-- logged that error on every tick.
--
-- Orchestrator is the only reader/writer of this table, so we add the columns
-- it expects and supply defaults for the NOT NULL columns it never populates.
-- The 0001 columns are left in place; treat the orchestrator's names as
-- authoritative and retire the duplicates once the service is refactored.
-- =============================================================================

ALTER TABLE lab.instances
    ADD COLUMN IF NOT EXISTS machine_slug    TEXT,
    ADD COLUMN IF NOT EXISTS state           TEXT,
    ADD COLUMN IF NOT EXISTS backend_ref     TEXT,
    ADD COLUMN IF NOT EXISTS backend_node    TEXT,
    ADD COLUMN IF NOT EXISTS ip_address      INET,
    ADD COLUMN IF NOT EXISTS vlan_tag        INTEGER,
    ADD COLUMN IF NOT EXISTS flag_user_hash  TEXT,
    ADD COLUMN IF NOT EXISTS flag_root_hash  TEXT,
    ADD COLUMN IF NOT EXISTS started_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS extensions_used INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_healthy_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS health_status   TEXT,
    ADD COLUMN IF NOT EXISTS failure_reason  TEXT,
    ADD COLUMN IF NOT EXISTS request_id      TEXT;

-- The orchestrator's INSERT lists only its own columns, so everything else
-- that is NOT NULL needs a default or the insert aborts.
ALTER TABLE lab.instances ALTER COLUMN content_type   SET DEFAULT 'machine';
ALTER TABLE lab.instances ALTER COLUMN image_ref      SET DEFAULT '';
ALTER TABLE lab.instances ALTER COLUMN flag_salt      SET DEFAULT '';
ALTER TABLE lab.instances ALTER COLUMN cpu_millicores SET DEFAULT 500;
ALTER TABLE lab.instances ALTER COLUMN memory_mb      SET DEFAULT 512;
ALTER TABLE lab.instances ALTER COLUMN expires_at     SET DEFAULT now() + INTERVAL '2 hours';

-- chk_instance_content requires machine_id when content_type = 'machine'.
-- The orchestrator always supplies machine_id, so the invariant still holds,
-- but it must tolerate the challenge/dojo/pro-lab rows it does not yet write.
ALTER TABLE lab.instances DROP CONSTRAINT IF EXISTS chk_instance_content;
ALTER TABLE lab.instances ADD CONSTRAINT chk_instance_content CHECK (
       (content_type = 'machine'    AND machine_id    IS NOT NULL)
    OR (content_type = 'challenge'  AND challenge_id  IS NOT NULL)
    OR (content_type = 'dojo_level' AND dojo_level_id IS NOT NULL)
    OR (content_type = 'pro_lab'    AND pro_lab_id    IS NOT NULL)
);

-- `state` mirrors `status`; keep the same allowed values.
ALTER TABLE lab.instances DROP CONSTRAINT IF EXISTS chk_instance_state;
ALTER TABLE lab.instances ADD CONSTRAINT chk_instance_state CHECK (
    state IS NULL OR state = ANY (ARRAY[
        'pending','requested','queued','scheduling','spawning','starting',
        'running','extending','terminating','terminated','failed'])
);

CREATE INDEX IF NOT EXISTS idx_instances_state ON lab.instances (state);
CREATE INDEX IF NOT EXISTS idx_instances_user_state ON lab.instances (user_id, state);
