-- =============================================================================
-- users — add teams.website
-- =============================================================================
-- user-svc's team repository selects `website` in teamSelectColumns and exposes
-- it in its update payload, but 0001 never created the column. Every team read
-- therefore failed with `column t.website does not exist`, which surfaced as a
-- 500 on GET /v1/teams/me — the whole team API was unusable.
-- =============================================================================

ALTER TABLE users.teams
    ADD COLUMN IF NOT EXISTS website TEXT;
