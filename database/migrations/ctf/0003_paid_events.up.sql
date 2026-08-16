-- =============================================================================
-- ctf — paid events (entry fee) + per-participant payment state
-- =============================================================================
-- Events could only be gated by subscription tier (required_tier). Running a
-- paid CTF needs a per-event entry fee and a record of who actually paid, so
-- registration can be blocked until payment settles.
--
-- entry_fee_cents = 0 means a free event; anything above 0 makes registration
-- payment-gated. Money is stored in minor units (cents/paisa) to avoid float.
-- =============================================================================

ALTER TABLE ctf.events
    ADD COLUMN IF NOT EXISTS entry_fee_cents INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS currency        TEXT    NOT NULL DEFAULT 'USD',
    ADD COLUMN IF NOT EXISTS refund_policy   TEXT;

ALTER TABLE ctf.events DROP CONSTRAINT IF EXISTS chk_ctf_entry_fee;
ALTER TABLE ctf.events ADD CONSTRAINT chk_ctf_entry_fee
    CHECK (entry_fee_cents >= 0);

-- Per-participant payment state. 'not_required' keeps every existing row valid
-- and is what free events use.
ALTER TABLE ctf.event_participants
    ADD COLUMN IF NOT EXISTS payment_status      TEXT NOT NULL DEFAULT 'not_required',
    ADD COLUMN IF NOT EXISTS amount_paid_cents   INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS payment_currency    TEXT,
    ADD COLUMN IF NOT EXISTS payment_provider    TEXT,
    ADD COLUMN IF NOT EXISTS payment_reference   TEXT,
    ADD COLUMN IF NOT EXISTS paid_at             TIMESTAMPTZ;

ALTER TABLE ctf.event_participants DROP CONSTRAINT IF EXISTS chk_participant_payment_status;
ALTER TABLE ctf.event_participants ADD CONSTRAINT chk_participant_payment_status
    CHECK (payment_status IN ('not_required','pending','paid','failed','refunded'));

-- Only one settled payment per provider reference.
CREATE UNIQUE INDEX IF NOT EXISTS idx_participant_payment_ref
    ON ctf.event_participants (payment_provider, payment_reference)
    WHERE payment_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_participant_payment_status
    ON ctf.event_participants (event_id, payment_status);
