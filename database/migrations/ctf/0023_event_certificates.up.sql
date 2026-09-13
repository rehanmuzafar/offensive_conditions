-- =============================================================================
-- ctf — certificates players can claim once an event is over
-- =============================================================================
-- One row per (event, player), created when they claim. Claiming is not just a
-- download: it fixes the figures.
--
-- The snapshot is the reason this is a table rather than a page that renders
-- from live data. Scoreboards get recomputed — a challenge is invalidated, a
-- submission is disqualified, a rank pin is added months later. A certificate
-- that quietly changes its own numbers afterwards is not a certificate, and
-- worse, one already shared with an employer would stop matching what the
-- verification page says. What was true at the moment of issue is what the
-- document says, for as long as it exists.
--
-- certificate_no is the public handle. It appears on the document and in the
-- verification URL, so it is unique on its own rather than only within an
-- event.
-- =============================================================================

CREATE TABLE IF NOT EXISTS ctf.event_certificates (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id       UUID NOT NULL REFERENCES ctf.events(id) ON DELETE CASCADE,
    user_id        UUID NOT NULL,

    certificate_no TEXT NOT NULL,

    -- Everything printed on the document, as it stood when it was issued.
    snapshot       JSONB NOT NULL,

    claimed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at     TIMESTAMPTZ,
    revoked_reason TEXT
);

-- One certificate per player per event. Claiming twice returns the first one
-- rather than minting a second with different numbers on it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_certificate_event_user
    ON ctf.event_certificates (event_id, user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_certificate_no
    ON ctf.event_certificates (certificate_no);

CREATE INDEX IF NOT EXISTS idx_certificate_user
    ON ctf.event_certificates (user_id, claimed_at DESC);
