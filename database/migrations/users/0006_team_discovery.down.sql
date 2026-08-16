DROP TABLE IF EXISTS users.team_join_requests;
DROP INDEX IF EXISTS users.idx_teams_category;
DROP INDEX IF EXISTS users.idx_teams_name_trgm;
ALTER TABLE users.teams
    DROP CONSTRAINT IF EXISTS chk_team_category,
    DROP COLUMN IF EXISTS category,
    DROP COLUMN IF EXISTS category_detail;
