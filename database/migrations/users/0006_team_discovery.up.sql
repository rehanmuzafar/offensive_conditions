-- =============================================================================
-- users — team categories, discovery and join requests
-- =============================================================================
-- Teams were invite-only and invisible: you could not browse them, and the only
-- way in was for a captain to invite you. This adds the other direction (a
-- player asks to join) and the classification players actually organise by —
-- country, employer, or place of study.
-- =============================================================================

ALTER TABLE users.teams
    ADD COLUMN IF NOT EXISTS category        TEXT NOT NULL DEFAULT 'open',
    -- The name of the company/university/school. Free text: the list of
    -- institutions is not ours to enumerate.
    ADD COLUMN IF NOT EXISTS category_detail TEXT;

ALTER TABLE users.teams DROP CONSTRAINT IF EXISTS chk_team_category;
ALTER TABLE users.teams ADD CONSTRAINT chk_team_category
    CHECK (category IN ('open', 'country', 'company', 'university', 'school'));

COMMENT ON COLUMN users.teams.category IS
    'open = anyone; country = uses country_code; company/university/school = category_detail names it.';

-- Discovery: browse by category, and search by name.
CREATE INDEX IF NOT EXISTS idx_teams_category
    ON users.teams (category, member_count DESC)
    WHERE disbanded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_teams_name_trgm
    ON users.teams USING gin (name gin_trgm_ops);

-- The mirror of team_invitations: the player asks, a captain decides.
CREATE TABLE IF NOT EXISTS users.team_join_requests (
    id           UUID PRIMARY KEY DEFAULT public.uuid_generate_v7(),
    team_id      UUID NOT NULL REFERENCES users.teams(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL,
    message      TEXT,
    status       TEXT NOT NULL DEFAULT 'pending',
    decided_by   UUID,
    decided_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_join_request_status
        CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled'))
);

-- One open request per person per team; a decided one can be re-requested.
CREATE UNIQUE INDEX IF NOT EXISTS uq_join_request_pending
    ON users.team_join_requests (team_id, user_id)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_join_requests_team
    ON users.team_join_requests (team_id, status);
CREATE INDEX IF NOT EXISTS idx_join_requests_user
    ON users.team_join_requests (user_id, status);
