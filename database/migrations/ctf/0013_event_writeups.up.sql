-- =============================================================================
-- ctf — event writeups
-- =============================================================================
-- Organisers ask the top teams to explain how they solved things, and the prize
-- usually depends on it. Two settings on the event decide who owes one:
--
--   writeup_required_top_n  how far down the board the requirement reaches
--   writeup_deadline        when it is due
--
-- Elimination is NOT stored. A team owes a writeup, the deadline passes, and it
-- is out — that is a fact about the clock and the rows, and computing it means
-- it becomes true at the right moment without a job to switch it on, and stops
-- being true the instant an organiser extends the deadline or a writeup lands.
-- A stored flag would need both to be kept in step and would be wrong in
-- between. (Same reasoning as events.paused_at in 0010.)
--
-- Which teams owe one is decided by the ranking *before* elimination. Deciding
-- it after would be circular: eliminating 3rd place promotes 4th into the top
-- three, who then also owe a writeup they were never asked for.
-- =============================================================================

ALTER TABLE ctf.events
    ADD COLUMN IF NOT EXISTS writeup_required_top_n integer,
    ADD COLUMN IF NOT EXISTS writeup_deadline       timestamptz;

ALTER TABLE ctf.events DROP CONSTRAINT IF EXISTS chk_event_writeup_top_n;
ALTER TABLE ctf.events ADD CONSTRAINT chk_event_writeup_top_n
    CHECK (writeup_required_top_n IS NULL OR writeup_required_top_n > 0);

COMMENT ON COLUMN ctf.events.writeup_required_top_n IS
    'How many teams from the top of the board must submit a writeup. NULL = nobody.';
COMMENT ON COLUMN ctf.events.writeup_deadline IS
    'When writeups are due. Teams that owe one and have not turned it in by now are eliminated.';


CREATE TABLE IF NOT EXISTS ctf.event_writeups (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id      uuid NOT NULL REFERENCES ctf.events(id) ON DELETE CASCADE,

    -- Exactly one, matching how the scoreboard groups entries.
    team_id       uuid,
    user_id       uuid,

    filename      text    NOT NULL,
    content_type  text    NOT NULL,
    size_bytes    bigint  NOT NULL,
    -- Object key in the private writeups bucket. Never served directly: the
    -- service streams it so the organiser's role is checked on every read.
    storage_key   text    NOT NULL,

    -- draft     uploaded, still replaceable by the captain
    -- submitted turned in; counts against the deadline and is frozen
    status        text    NOT NULL DEFAULT 'draft',
    submitted_at  timestamptz,

    uploaded_by   uuid    NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT chk_writeup_subject CHECK (
        (team_id IS NOT NULL AND user_id IS NULL)
     OR (team_id IS NULL AND user_id IS NOT NULL)
    ),
    CONSTRAINT chk_writeup_status CHECK (status IN ('draft', 'submitted')),
    -- Turned in means there is a time on it.
    CONSTRAINT chk_writeup_submitted_at CHECK (
        (status = 'draft'     AND submitted_at IS NULL)
     OR (status = 'submitted' AND submitted_at IS NOT NULL)
    )
);

-- One writeup per entry per event. Replacing a draft overwrites this row rather
-- than accumulating versions: the captain is fixing a mistake, not keeping a
-- history, and a second row would make "have they submitted?" ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS uq_writeup_event_team
    ON ctf.event_writeups (event_id, team_id) WHERE team_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_writeup_event_user
    ON ctf.event_writeups (event_id, user_id) WHERE user_id IS NOT NULL;

COMMENT ON TABLE ctf.event_writeups IS
    'One writeup per entry per event; draft until the captain turns it in.';
