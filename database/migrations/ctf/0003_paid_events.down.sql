DROP INDEX IF EXISTS ctf.idx_participant_payment_ref;
DROP INDEX IF EXISTS ctf.idx_participant_payment_status;
ALTER TABLE ctf.event_participants
    DROP COLUMN IF EXISTS payment_status, DROP COLUMN IF EXISTS amount_paid_cents,
    DROP COLUMN IF EXISTS payment_currency, DROP COLUMN IF EXISTS payment_provider,
    DROP COLUMN IF EXISTS payment_reference, DROP COLUMN IF EXISTS paid_at;
ALTER TABLE ctf.events
    DROP COLUMN IF EXISTS entry_fee_cents, DROP COLUMN IF EXISTS currency,
    DROP COLUMN IF EXISTS refund_policy;
