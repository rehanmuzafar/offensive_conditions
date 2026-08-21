-- =============================================================================
-- bounty — program announcements
-- =============================================================================
-- A program's scope and rewards change over time, and hackers need to hear
-- about it: a newly added asset is the most valuable thing a program can tell
-- them, and a newly excluded one prevents wasted work.
--
-- Its own table rather than a field on the program, because these are a running
-- log the program appends to — the point is the history, not the current value.
-- =============================================================================

CREATE TABLE IF NOT EXISTS bounty.program_updates (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    program_id  uuid NOT NULL REFERENCES bounty.programs(id) ON DELETE CASCADE,
    author_id   uuid NOT NULL,
    title       text NOT NULL,
    body_md     text NOT NULL,
    --: Drafts let a program write an announcement alongside a scope change and
    --: publish both at once.
    published   boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_program_updates_program
    ON bounty.program_updates (program_id, created_at DESC);

COMMENT ON TABLE bounty.program_updates IS
    'Announcements a program posts to its hackers. See migration bounty/0002.';
