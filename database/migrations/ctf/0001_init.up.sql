-- =============================================================================
-- CTF Schema — Initial Migration
-- =============================================================================
-- Time-bound competitive hacking events
-- =============================================================================

SET search_path = ctf, public;

-- ---------------------------------------------------------------------------
-- CTF Events
-- ---------------------------------------------------------------------------
CREATE TABLE ctf.events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            CITEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    description     TEXT,
    overview_markdown TEXT,
    -- Format
    format          TEXT NOT NULL DEFAULT 'jeopardy',      -- jeopardy|attack_defense|hybrid|king_of_hill
    visibility      TEXT NOT NULL DEFAULT 'public',        -- public|private|invite_only
    team_play       BOOLEAN NOT NULL DEFAULT TRUE,
    solo_play       BOOLEAN NOT NULL DEFAULT TRUE,
    max_team_size   INT DEFAULT 4,
    -- Timing
    registration_starts_at TIMESTAMPTZ NOT NULL,
    registration_ends_at   TIMESTAMPTZ NOT NULL,
    starts_at       TIMESTAMPTZ NOT NULL,
    ends_at         TIMESTAMPTZ NOT NULL,
    scoreboard_freeze_at TIMESTAMPTZ,                      -- Freeze last hour
    -- Scoring
    dynamic_scoring BOOLEAN NOT NULL DEFAULT TRUE,         -- Points decrease with more solvers
    min_points      INT NOT NULL DEFAULT 50,               -- Floor for dynamic scoring
    first_blood_bonus INT NOT NULL DEFAULT 0,              -- Extra points for first solver
    -- Access
    required_tier   TEXT NOT NULL DEFAULT 'free',
    invitation_only BOOLEAN NOT NULL DEFAULT FALSE,
    invitation_code TEXT,                                  -- Required for private events
    max_participants INT,                                  -- NULL = unlimited
    -- Prizes
    prize_pool      JSONB DEFAULT '[]'::JSONB,             -- [{rank, prize_description, amount, currency}]
    -- Status
    status          TEXT NOT NULL DEFAULT 'draft',         -- draft|published|registration|live|ended|archived
    cover_image_url TEXT,
    rules_markdown  TEXT,
    sponsor_info    JSONB DEFAULT '{}'::JSONB,
    -- Stats
    total_registered INT NOT NULL DEFAULT 0,
    total_teams     INT NOT NULL DEFAULT 0,
    created_by      UUID NOT NULL,
    metadata        JSONB DEFAULT '{}'::JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_ctf_format CHECK (format IN ('jeopardy','attack_defense','hybrid','king_of_hill')),
    CONSTRAINT chk_ctf_visibility CHECK (visibility IN ('public','private','invite_only')),
    CONSTRAINT chk_ctf_status CHECK (status IN ('draft','published','registration','live','ended','archived')),
    CONSTRAINT chk_ctf_timing CHECK (
        registration_starts_at < registration_ends_at AND
        registration_ends_at <= starts_at AND
        starts_at < ends_at
    )
);

CREATE INDEX idx_events_status ON ctf.events (status, starts_at);
CREATE INDEX idx_events_starts ON ctf.events (starts_at) WHERE status IN ('published','registration','live');
CREATE INDEX idx_events_visibility ON ctf.events (visibility) WHERE status = 'live';

CREATE TRIGGER trg_events_updated_at
    BEFORE UPDATE ON ctf.events
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Event Challenges
-- ---------------------------------------------------------------------------
CREATE TABLE ctf.event_challenges (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id        UUID NOT NULL REFERENCES ctf.events(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    category        TEXT NOT NULL,
    difficulty      TEXT,
    description     TEXT NOT NULL,
    -- Scoring
    base_points     INT NOT NULL,
    current_points  INT NOT NULL,                          -- Updated by dynamic scoring engine
    -- Lab config
    requires_instance BOOLEAN NOT NULL DEFAULT FALSE,
    image_ref       TEXT,
    files           JSONB DEFAULT '[]'::JSONB,
    -- Flag
    static_flag_hash TEXT,                                 -- For non-instance challenges
    flag_pattern    TEXT,                                  -- Regex for valid flag format (used in validation)
    -- Gating
    unlocks_at      TIMESTAMPTZ,                           -- For staged release
    requires_solving_ids UUID[] DEFAULT '{}',              -- Prerequisite challenges
    -- Hints
    hints           JSONB DEFAULT '[]'::JSONB,             -- [{id, text, point_deduction}]
    -- Stats (denormalized)
    total_solves    INT NOT NULL DEFAULT 0,
    first_blood_user_id UUID,
    first_blood_team_id UUID,
    first_blood_at  TIMESTAMPTZ,
    -- Order
    sort_order      INT NOT NULL DEFAULT 0,
    is_hidden       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_event_challenges_event ON ctf.event_challenges (event_id, category, sort_order);

CREATE TRIGGER trg_event_challenges_updated_at
    BEFORE UPDATE ON ctf.event_challenges
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Event Participants (solo or team registrations)
-- ---------------------------------------------------------------------------
CREATE TABLE ctf.event_participants (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id        UUID NOT NULL REFERENCES ctf.events(id) ON DELETE CASCADE,
    -- Participant: user (solo) OR team (group)
    participant_type TEXT NOT NULL,                        -- user|team
    user_id         UUID,                                  -- if solo
    team_id         UUID,                                  -- if team
    team_name_at_event TEXT,                               -- Snapshot in case team renames
    -- Stats
    points          INT NOT NULL DEFAULT 0,
    solve_count     INT NOT NULL DEFAULT 0,
    last_solve_at   TIMESTAMPTZ,
    rank            INT,                                   -- Updated by ranking job
    is_disqualified BOOLEAN NOT NULL DEFAULT FALSE,
    disqualification_reason TEXT,
    registered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_event_participant_type CHECK (participant_type IN ('user','team')),
    CONSTRAINT chk_event_participant_id CHECK (
        (participant_type = 'user' AND user_id IS NOT NULL) OR
        (participant_type = 'team' AND team_id IS NOT NULL)
    ),
    CONSTRAINT uq_event_user UNIQUE (event_id, user_id),
    CONSTRAINT uq_event_team UNIQUE (event_id, team_id)
);

CREATE INDEX idx_participants_event_points ON ctf.event_participants (event_id, points DESC, last_solve_at);
CREATE INDEX idx_participants_user ON ctf.event_participants (user_id);

-- ---------------------------------------------------------------------------
-- Event Solves (submission record per event)
-- ---------------------------------------------------------------------------
CREATE TABLE ctf.event_solves (
    id              UUID PRIMARY KEY DEFAULT public.uuid_generate_v7(),
    event_id        UUID NOT NULL REFERENCES ctf.events(id) ON DELETE CASCADE,
    challenge_id    UUID NOT NULL REFERENCES ctf.event_challenges(id) ON DELETE CASCADE,
    participant_id  UUID NOT NULL REFERENCES ctf.event_participants(id) ON DELETE CASCADE,
    solving_user_id UUID NOT NULL,                         -- Specific user who solved (even in team context)
    points_at_solve INT NOT NULL,                          -- Snapshot of points at time of solve
    hints_used      INT NOT NULL DEFAULT 0,
    point_deduction INT NOT NULL DEFAULT 0,
    is_first_blood  BOOLEAN NOT NULL DEFAULT FALSE,
    solved_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_event_challenge_participant UNIQUE (event_id, challenge_id, participant_id)
);

CREATE INDEX idx_event_solves_participant ON ctf.event_solves (participant_id, solved_at);
CREATE INDEX idx_event_solves_challenge ON ctf.event_solves (challenge_id, solved_at);
