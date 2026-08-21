ALTER TABLE ctf.score_adjustments DROP COLUMN IF EXISTS visible;
-- reason: left nullable. Re-adding NOT NULL would fail on rows written without
-- one, and inventing text for them would be worse than the looser column.

ALTER TABLE ctf.events DROP CONSTRAINT IF EXISTS chk_ctf_timing;
ALTER TABLE ctf.events ADD CONSTRAINT chk_ctf_timing
    CHECK (
        registration_starts_at < registration_ends_at
        AND registration_ends_at <= starts_at
        AND starts_at < ends_at
    );
