-- =============================================================================
-- ctf — pinned scoreboard positions
-- =============================================================================
-- A jury sometimes decides a placement the points do not produce: a tie broken
-- on writeup quality, a sanction that moves a team down without taking points
-- off them, a final adjudicated on something the scoring never saw.
--
-- This is deliberately NOT event_participants.rank. That column is rebuilt from
-- points every thirty seconds by recompute_ranks, so an override written there
-- would survive until the next tick and then quietly vanish — the worst kind of
-- bug, because it looks like it worked.
--
-- It is also worth being plain about what a pin costs. The board's promise is
-- "more points finishes higher", and a pin breaks that promise for one row.
-- Nothing here can make that untrue, so the design makes it *visible* instead:
-- every pin carries who set it and why, and the API marks pinned rows so the
-- scoreboard can say so rather than silently contradicting itself.
--
-- One team per position, and one position per team: without both, "who is
-- second?" stops having an answer.
-- =============================================================================

CREATE TABLE IF NOT EXISTS ctf.rank_pins (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id   uuid NOT NULL REFERENCES ctf.events(id) ON DELETE CASCADE,

    -- Exactly one, matching how the scoreboard groups entries.
    team_id    uuid,
    user_id    uuid,

    --: 1-based, as displayed. A pin past the end of the board settles at the end.
    position   integer NOT NULL,
    reason     text,

    actor_id   uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT chk_rank_pin_subject CHECK (
        (team_id IS NOT NULL AND user_id IS NULL)
     OR (team_id IS NULL AND user_id IS NOT NULL)
    ),
    CONSTRAINT chk_rank_pin_position CHECK (position > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_rank_pin_position
    ON ctf.rank_pins (event_id, position);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rank_pin_team
    ON ctf.rank_pins (event_id, team_id) WHERE team_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_rank_pin_user
    ON ctf.rank_pins (event_id, user_id) WHERE user_id IS NOT NULL;

COMMENT ON TABLE ctf.rank_pins IS
    'Organiser-set scoreboard positions. Overrides points ordering for one row; always surfaced as pinned.';
