-- =============================================================================
-- lab — capacity_snapshots
-- =============================================================================
-- The orchestrator's CapacityRepository reads and upserts lab.capacity_snapshots
-- (internal/repository/postgres.go), but 0001 never created the table, so the
-- admin capacity endpoint returned 500 and the periodic capacity snapshot
-- writer failed silently. Column types follow the CapacitySnapshot struct.
-- =============================================================================

CREATE TABLE IF NOT EXISTS lab.capacity_snapshots (
    backend           TEXT   NOT NULL,
    node              TEXT   NOT NULL,
    total_cpu_millis  BIGINT NOT NULL DEFAULT 0,
    used_cpu_millis   BIGINT NOT NULL DEFAULT 0,
    total_mem_mb      BIGINT NOT NULL DEFAULT 0,
    used_mem_mb       BIGINT NOT NULL DEFAULT 0,
    instances_running INTEGER NOT NULL DEFAULT 0,
    instances_max     INTEGER NOT NULL DEFAULT 0,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- the repository upserts with ON CONFLICT (backend, node)
    PRIMARY KEY (backend, node),
    CONSTRAINT chk_capacity_backend CHECK (backend IN ('container','vm'))
);

CREATE INDEX IF NOT EXISTS idx_capacity_updated ON lab.capacity_snapshots (updated_at DESC);
