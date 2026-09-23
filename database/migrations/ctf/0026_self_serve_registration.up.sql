-- =============================================================================
-- ctf — a per-event switch for self-serve registration
-- =============================================================================
-- A paid event's self-serve path takes a player to a card checkout. Until
-- there is a working merchant account behind it, letting players self-serve
-- would run them into an entry fee that cannot actually be collected. This
-- gives an organiser a way to keep an event priced (prize pool, branding,
-- reporting) while requiring every entry to be added by hand -- the existing
-- admin_comp path already does that without touching a payment gateway.
--
-- Default true: every event created before this migration keeps working
-- exactly as it does today.
-- =============================================================================

ALTER TABLE ctf.events
    ADD COLUMN IF NOT EXISTS self_serve_registration BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN ctf.events.self_serve_registration IS
    'False disables the player-initiated register/pay flow entirely -- an organiser adds every entry by hand instead. Independent of entry_fee_cents: an event can still be priced while every seat is admin-added.';
