DROP INDEX IF EXISTS scoring.uq_season_number;
ALTER TABLE scoring.seasons DROP COLUMN IF EXISTS number;
-- Names are left as they are: the quarter names they replaced are recoverable
-- from `code`, and inventing them back would be guesswork.
