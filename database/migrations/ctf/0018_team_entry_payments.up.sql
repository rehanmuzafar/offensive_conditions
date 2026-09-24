-- =============================================================================
-- ctf — the entry fee belongs to the team, not to each player
-- =============================================================================
-- 0003 put payment state on ctf.event_participants, one row per player. That
-- is the wrong owner for a team event, and it shows up the moment a roster
-- changes: a captain pays, then swaps a player in, and the new player arrives
-- with their own 'pending' row and no way into an event the team has already
-- paid for. Charging them again is not an option — the team bought one entry.
--
-- So the entry becomes a row of its own, keyed on (event_id, team_id). One
-- team, one payment, made by the captain. Who is on the roster afterwards is a
-- separate question, and deliberately not this table's business.
--
-- The per-participant columns stay where they are. Solo registration still
-- uses them, and this table does not describe an individual paying for
-- themselves.
-- =============================================================================

CREATE TABLE IF NOT EXISTS ctf.event_team_entries (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id           UUID NOT NULL REFERENCES ctf.events(id) ON DELETE CASCADE,
    team_id            UUID NOT NULL,

    -- The captain at the time of payment, kept as a record of who paid rather
    -- than as a live pointer: captaincy can change hands, and that must not
    -- rewrite the history of the transaction.
    paid_by_user_id    UUID,

    payment_status     TEXT    NOT NULL DEFAULT 'pending',
    amount_cents       INTEGER NOT NULL DEFAULT 0,
    currency           TEXT,
    provider           TEXT,

    -- The gateway's own identifier. Unique so a webhook delivered twice — which
    -- every gateway does — cannot settle the same entry twice.
    provider_reference TEXT,

    paid_at            TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE ctf.event_team_entries DROP CONSTRAINT IF EXISTS chk_team_entry_payment_status;
ALTER TABLE ctf.event_team_entries ADD CONSTRAINT chk_team_entry_payment_status
    CHECK (payment_status IN ('not_required','pending','paid','failed','refunded'));

ALTER TABLE ctf.event_team_entries DROP CONSTRAINT IF EXISTS chk_team_entry_amount;
ALTER TABLE ctf.event_team_entries ADD CONSTRAINT chk_team_entry_amount
    CHECK (amount_cents >= 0);

-- One entry per team per event. This is the constraint the whole feature rests
-- on: it is what makes a second payment impossible rather than merely unlikely.
CREATE UNIQUE INDEX IF NOT EXISTS idx_team_entry_event_team
    ON ctf.event_team_entries (event_id, team_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_team_entry_provider_ref
    ON ctf.event_team_entries (provider, provider_reference)
    WHERE provider_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_team_entry_status
    ON ctf.event_team_entries (event_id, payment_status);

-- -----------------------------------------------------------------------------
-- Existing teams keep their place.
--
-- register_team never checked the fee, so teams are already registered for paid
-- events without having paid. Marking those 'pending' would lock out teams that
-- did nothing wrong and were told they were in. They are recorded as settled,
-- with no provider, which is also an honest description of what happened: the
-- entry was granted rather than bought.
-- -----------------------------------------------------------------------------
INSERT INTO ctf.event_team_entries
    (event_id, team_id, payment_status, amount_cents, currency, provider, paid_at)
SELECT DISTINCT
    p.event_id,
    p.team_id,
    'paid',
    0,
    e.currency,
    'grandfathered',
    now()
FROM ctf.event_participants p
JOIN ctf.events e ON e.id = p.event_id
WHERE p.team_id IS NOT NULL
ON CONFLICT DO NOTHING;
