-- =============================================================================
-- ctf — registration can stay open until the event itself ends
-- =============================================================================
-- Closing registration before an event finishes turns away players who could
-- still have played, and there is no reason to for either a free CTF or a paid
-- one: a late entrant simply has less time on the clock. Some events do want a
-- hard cut-off — a fixed roster, printed brackets, a physical venue — so it
-- stays a choice rather than becoming a rule.
--
-- When this is on, registration_ends_at is ignored and the event's own end is
-- used. The column is left in place rather than rewritten, so switching back
-- to a fixed date restores the date the organiser originally set instead of
-- silently losing it.
--
-- Default true, and existing events are switched: none of them chose a
-- cut-off deliberately — every registration_ends_at so far came from a form
-- that required one.
-- =============================================================================

ALTER TABLE ctf.events
    ADD COLUMN IF NOT EXISTS registration_until_end BOOLEAN NOT NULL DEFAULT true;

UPDATE ctf.events SET registration_until_end = true;
