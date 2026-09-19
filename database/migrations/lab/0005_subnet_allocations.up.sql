-- =============================================================================
-- lab — per-instance subnet allocations
-- =============================================================================
-- The orchestrator has always written here on spawn and released on teardown,
-- but the table was never created: 0001 shipped lab.network_allocations, which
-- is a different thing entirely — one persistent network per *user*, keyed on
-- user_id, carrying a VLAN and a gateway. What the code wants is one row per
-- *instance*, with a lifecycle.
--
-- The in-memory allocator hands out the CIDR; this table is only how it
-- remembers. The insert's failure was logged as a warning and the spawn carried
-- on, so nothing looked broken — until a restart, when hydration found nothing
-- and the allocator could hand a live instance's range to the next caller.
--
-- Rows are kept after release rather than deleted: which range a user held, and
-- when, is the first thing anyone asks when two instances turn out to have been
-- able to see each other.
-- =============================================================================

CREATE TABLE IF NOT EXISTS lab.subnet_allocations (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL,

    --: Nullable so a range can be reserved before an instance row exists, and
    --: so an instance's deletion does not take the record of it with it.
    instance_id  uuid,

    cidr         cidr NOT NULL,
    state        text NOT NULL DEFAULT 'allocated',

    allocated_at timestamptz NOT NULL DEFAULT now(),
    released_at  timestamptz,

    CONSTRAINT chk_subnet_state CHECK (state IN ('allocated', 'released')),
    --: released rows must say when; allocated rows must not.
    CONSTRAINT chk_subnet_released_at CHECK (
        (state = 'released' AND released_at IS NOT NULL)
     OR (state = 'allocated' AND released_at IS NULL)
    )
);

-- One live allocation per range. Partial, because a released row is history and
-- the same range is expected to come round again.
CREATE UNIQUE INDEX IF NOT EXISTS uq_subnet_alloc_live_cidr
    ON lab.subnet_allocations (cidr) WHERE state = 'allocated';

-- Release() and GetByInstance() both look a row up by instance while it is live.
CREATE UNIQUE INDEX IF NOT EXISTS uq_subnet_alloc_live_instance
    ON lab.subnet_allocations (instance_id)
    WHERE state = 'allocated' AND instance_id IS NOT NULL;

-- Hydration on startup reads every live CIDR; this is the whole query.
CREATE INDEX IF NOT EXISTS idx_subnet_alloc_state
    ON lab.subnet_allocations (state) WHERE state = 'allocated';

COMMENT ON TABLE lab.subnet_allocations IS
    'Per-instance network ranges. Durability for the in-memory allocator, so a restart does not reissue a range that is still in use.';
