-- =============================================================================
-- ctf — pausing a live event
-- =============================================================================
-- An organiser needs to stop the clock: infrastructure falls over, a challenge
-- turns out to be broken, or a flag leaks and everyone has to wait while it is
-- rotated. Until now the only lever was ending the event, which is final.
--
-- Pause is deliberately NOT a value of events.status. Status is the event's
-- lifecycle — draft, published, live, ended — and a pause does not move it: the
-- event is still live, it is simply not accepting play right now. Folding it
-- into status would mean every query that asks "is this event live?" has to
-- learn about a state that is not really a lifecycle stage, and resuming would
-- have to guess which status to go back to.
--
-- Two ways to pause, and they must be able to coexist:
--   • paused_at        an organiser pressed the button; stays until they resume
--   • pause_starts_at  a window they scheduled in advance
--     pause_ends_at
--
-- Effective pause is the OR of the two, computed at read time so a scheduled
-- window needs no job to switch it on. Resuming manually clears both, which is
-- what makes "resume early" end a scheduled window rather than fight it.
-- =============================================================================

ALTER TABLE ctf.events
    ADD COLUMN IF NOT EXISTS paused_at        timestamptz,
    ADD COLUMN IF NOT EXISTS pause_starts_at  timestamptz,
    ADD COLUMN IF NOT EXISTS pause_ends_at    timestamptz,
    ADD COLUMN IF NOT EXISTS pause_reason     text;

-- A window has to be a window. Nothing enforces that a scheduled pause lies
-- inside the event, on purpose: an organiser may schedule one before the event
-- starts, and the clock only matters once it is live.
ALTER TABLE ctf.events DROP CONSTRAINT IF EXISTS chk_event_pause_window;
ALTER TABLE ctf.events ADD CONSTRAINT chk_event_pause_window
    CHECK (
        pause_starts_at IS NULL
        OR pause_ends_at IS NULL
        OR pause_ends_at > pause_starts_at
    );

COMMENT ON COLUMN ctf.events.paused_at IS
    'Set when an organiser paused by hand; NULL means not manually paused.';
COMMENT ON COLUMN ctf.events.pause_starts_at IS
    'Start of a scheduled pause window. Cleared when an organiser resumes early.';
COMMENT ON COLUMN ctf.events.pause_ends_at IS
    'End of a scheduled pause window.';
