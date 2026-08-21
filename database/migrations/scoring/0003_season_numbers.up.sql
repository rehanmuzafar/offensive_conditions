-- =============================================================================
-- scoring — seasons are numbered, and they start at 1
-- =============================================================================
-- Seasons were named after the quarter they fell in — "Spring 2026", code
-- 2026-Q2 — which reads as a date, not as a count. A ladder that "resets every
-- 90 days" wants an ordinal: players talk about Season 3, not about Q4 2026,
-- and the number is what makes "this is the fourth one" legible at a glance.
--
-- The number is stored rather than derived from ordering, because rollover
-- needs it *before* the row exists: the next season is named from the previous
-- one's number + 1, and a name that depends on a count could disagree with the
-- name already printed on a page.
--
-- Backfilled by start date, so the earliest season becomes Season 1 regardless
-- of what it was called.
-- =============================================================================

ALTER TABLE scoring.seasons ADD COLUMN IF NOT EXISTS number integer;

WITH ordered AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY starts_at, created_at) AS n
      FROM scoring.seasons
)
UPDATE scoring.seasons s
   SET number = ordered.n,
       -- The stored name follows the number. The quarter is still in `code`
       -- for anyone who needs to know when it ran.
       name = 'Season ' || ordered.n
  FROM ordered
 WHERE s.id = ordered.id
   AND (s.number IS DISTINCT FROM ordered.n OR s.name IS DISTINCT FROM 'Season ' || ordered.n);

ALTER TABLE scoring.seasons ALTER COLUMN number SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_season_number ON scoring.seasons (number);

COMMENT ON COLUMN scoring.seasons.number IS
    'Ordinal, starting at 1. The next season is this + 1.';
