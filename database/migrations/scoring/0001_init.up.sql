-- =============================================================================
-- Scoring Schema — Initial Migration
-- =============================================================================
-- Handles: flag submissions, points history, achievements, leaderboards
-- Note: Live leaderboard data is in Redis (sorted sets) — this is the source of truth
-- =============================================================================

SET search_path = scoring, public;

-- ---------------------------------------------------------------------------
-- Submissions (every flag submission attempt)
-- ---------------------------------------------------------------------------
CREATE TABLE scoring.submissions (
    id              UUID NOT NULL DEFAULT public.uuid_generate_v7(),
    user_id         UUID NOT NULL,
    team_id         UUID,                                  -- If submitted as part of team
    -- What was submitted to
    content_type    TEXT NOT NULL,                         -- machine|challenge|dojo_level|ctf_challenge|prolab_flag
    content_id      UUID NOT NULL,                         -- ID of the machine/challenge/level
    instance_id     UUID,                                  -- The lab instance (if applicable)
    flag_type       TEXT,                                  -- user|root|challenge|prolab
    -- Submitted data
    submitted_value TEXT NOT NULL,                         -- Hashed for storage (SHA-256)
    submitted_raw_length INT,                              -- Length of raw flag, helps detect garbage
    -- Result
    accepted        BOOLEAN NOT NULL,
    rejection_reason TEXT,                                 -- wrong_flag|expired_instance|cooldown|rate_limit|...
    points_awarded  INT NOT NULL DEFAULT 0,
    is_first_blood  BOOLEAN NOT NULL DEFAULT FALSE,        -- First N solvers (config-driven)
    blood_rank      INT,                                   -- 1, 2, 3 for first blood, second, third
    -- Context (for analytics + anti-cheat)
    ip_address      INET,
    user_agent      TEXT,
    response_time_ms INT,                                  -- Server-side processing time
    seconds_since_spawn INT,                               -- For solve-time analytics
    -- Anti-cheat scoring
    suspicion_score NUMERIC(5,2) DEFAULT 0,                -- 0-100, computed
    flagged_for_review BOOLEAN NOT NULL DEFAULT FALSE,
    submitted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_sub_content_type CHECK (content_type IN ('machine','challenge','dojo_level','ctf_challenge','prolab_flag')),
    CONSTRAINT chk_sub_flag_type CHECK (flag_type IS NULL OR flag_type IN ('user','root','challenge','prolab')),

    PRIMARY KEY (id, submitted_at)
) PARTITION BY RANGE (submitted_at);

-- Monthly partitions
CREATE TABLE scoring.submissions_2026_05 PARTITION OF scoring.submissions
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE scoring.submissions_2026_06 PARTITION OF scoring.submissions
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE scoring.submissions_2026_07 PARTITION OF scoring.submissions
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

CREATE INDEX idx_submissions_user ON scoring.submissions (user_id, submitted_at DESC);
CREATE INDEX idx_submissions_content ON scoring.submissions (content_type, content_id, submitted_at DESC);
CREATE INDEX idx_submissions_accepted ON scoring.submissions (user_id, content_id, flag_type) WHERE accepted = TRUE;
CREATE INDEX idx_submissions_flagged ON scoring.submissions (submitted_at DESC) WHERE flagged_for_review = TRUE;
CREATE INDEX idx_submissions_ip ON scoring.submissions (ip_address, submitted_at DESC);

-- ---------------------------------------------------------------------------
-- Owns (denormalized: who has solved what)
-- ---------------------------------------------------------------------------
-- A successful submission creates an "own" record. Easier queries than scanning submissions.
CREATE TABLE scoring.owns (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL,
    content_type    TEXT NOT NULL,
    content_id      UUID NOT NULL,
    flag_type       TEXT,                                  -- user|root|challenge|null for paths
    points          INT NOT NULL,
    is_first_blood  BOOLEAN NOT NULL DEFAULT FALSE,
    blood_rank      INT,
    solve_time_seconds INT,                                -- From content release or instance spawn
    submission_id   UUID,                                  -- Link to scoring.submissions
    owned_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_user_content_flag UNIQUE (user_id, content_type, content_id, flag_type),
    CONSTRAINT chk_owns_content_type CHECK (content_type IN ('machine','challenge','dojo_level','ctf_challenge','prolab_flag','path'))
);

CREATE INDEX idx_owns_user ON scoring.owns (user_id, owned_at DESC);
CREATE INDEX idx_owns_content ON scoring.owns (content_type, content_id, owned_at DESC);
CREATE INDEX idx_owns_first_blood ON scoring.owns (content_type, content_id, blood_rank) WHERE is_first_blood = TRUE;

-- ---------------------------------------------------------------------------
-- Point History (event log of point changes)
-- ---------------------------------------------------------------------------
CREATE TABLE scoring.point_history (
    id              UUID NOT NULL DEFAULT public.uuid_generate_v7(),
    user_id         UUID NOT NULL,
    event_type      TEXT NOT NULL,                         -- machine_own|challenge_solve|first_blood|streak|achievement|decay|admin
    points          INT NOT NULL,                          -- Can be negative (decay, admin penalty)
    reference_type  TEXT,                                  -- What entity this relates to
    reference_id    UUID,
    description     TEXT,
    metadata        JSONB DEFAULT '{}'::JSONB,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE scoring.point_history_2026_05 PARTITION OF scoring.point_history
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE scoring.point_history_2026_06 PARTITION OF scoring.point_history
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE scoring.point_history_2026_07 PARTITION OF scoring.point_history
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

CREATE INDEX idx_point_history_user ON scoring.point_history (user_id, occurred_at DESC);
CREATE INDEX idx_point_history_event ON scoring.point_history (event_type, occurred_at DESC);

-- ---------------------------------------------------------------------------
-- User Score Summary (denormalized aggregate)
-- ---------------------------------------------------------------------------
CREATE TABLE scoring.user_scores (
    user_id         UUID PRIMARY KEY,
    -- Total
    total_points    BIGINT NOT NULL DEFAULT 0,
    -- Per category (denormalized for fast rank queries)
    machine_points  BIGINT NOT NULL DEFAULT 0,
    challenge_points BIGINT NOT NULL DEFAULT 0,
    dojo_points     BIGINT NOT NULL DEFAULT 0,
    ctf_points      BIGINT NOT NULL DEFAULT 0,
    prolab_points   BIGINT NOT NULL DEFAULT 0,
    bonus_points    BIGINT NOT NULL DEFAULT 0,             -- First blood, achievements, streaks
    -- Counters
    machines_owned  INT NOT NULL DEFAULT 0,
    user_flags_count INT NOT NULL DEFAULT 0,
    root_flags_count INT NOT NULL DEFAULT 0,
    challenges_solved INT NOT NULL DEFAULT 0,
    first_bloods    INT NOT NULL DEFAULT 0,
    -- Time-windowed (for "rising stars", monthly leaderboards)
    points_30d      BIGINT NOT NULL DEFAULT 0,
    points_7d       BIGINT NOT NULL DEFAULT 0,
    -- Ranks (denormalized, recomputed by job)
    global_rank     INT,
    country_rank    INT,
    country_code    CHAR(2),
    rank_tier       TEXT,                                  -- noob|script_kiddie|hacker|pro_hacker|elite_hacker|guru|omniscient
    -- Streak
    current_streak_days INT NOT NULL DEFAULT 0,
    longest_streak_days INT NOT NULL DEFAULT 0,
    last_solve_date DATE,
    -- Last update
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_scores_total ON scoring.user_scores (total_points DESC);
CREATE INDEX idx_user_scores_country ON scoring.user_scores (country_code, total_points DESC);
CREATE INDEX idx_user_scores_30d ON scoring.user_scores (points_30d DESC);
CREATE INDEX idx_user_scores_tier ON scoring.user_scores (rank_tier);

CREATE TRIGGER trg_user_scores_updated_at
    BEFORE UPDATE ON scoring.user_scores
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Team Score Summary
-- ---------------------------------------------------------------------------
CREATE TABLE scoring.team_scores (
    team_id         UUID PRIMARY KEY,
    total_points    BIGINT NOT NULL DEFAULT 0,
    machines_owned  INT NOT NULL DEFAULT 0,
    challenges_solved INT NOT NULL DEFAULT 0,
    member_count    INT NOT NULL DEFAULT 0,
    avg_points_per_member NUMERIC(12,2),
    global_rank     INT,
    country_rank    INT,
    country_code    CHAR(2),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_team_scores_total ON scoring.team_scores (total_points DESC);
CREATE INDEX idx_team_scores_country ON scoring.team_scores (country_code, total_points DESC);

CREATE TRIGGER trg_team_scores_updated_at
    BEFORE UPDATE ON scoring.team_scores
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Achievements (badges)
-- ---------------------------------------------------------------------------
CREATE TABLE scoring.achievements (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            CITEXT NOT NULL UNIQUE,                -- e.g. "first_machine_pwned"
    name            TEXT NOT NULL,
    description     TEXT NOT NULL,
    category        TEXT NOT NULL,                         -- progression|mastery|community|special
    rarity          TEXT NOT NULL DEFAULT 'common',        -- common|uncommon|rare|epic|legendary|mythic
    icon_url        TEXT,
    points_awarded  INT NOT NULL DEFAULT 0,
    -- Trigger conditions (for auto-award engine)
    trigger_type    TEXT NOT NULL,                         -- count|threshold|streak|manual|first|specific
    trigger_config  JSONB NOT NULL DEFAULT '{}'::JSONB,
    -- Display
    is_secret       BOOLEAN NOT NULL DEFAULT FALSE,        -- Hidden until earned
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order      INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_ach_category CHECK (category IN ('progression','mastery','community','special')),
    CONSTRAINT chk_ach_rarity CHECK (rarity IN ('common','uncommon','rare','epic','legendary','mythic')),
    CONSTRAINT chk_ach_trigger CHECK (trigger_type IN ('count','threshold','streak','manual','first','specific'))
);

CREATE INDEX idx_achievements_active ON scoring.achievements (category, sort_order) WHERE is_active = TRUE;

-- ---------------------------------------------------------------------------
-- User Achievements (M:N)
-- ---------------------------------------------------------------------------
CREATE TABLE scoring.user_achievements (
    user_id         UUID NOT NULL,
    achievement_id  UUID NOT NULL REFERENCES scoring.achievements(id) ON DELETE CASCADE,
    progress        NUMERIC(5,2) DEFAULT 100.00,           -- For "n of m" type achievements
    unlocked_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    displayed       BOOLEAN NOT NULL DEFAULT FALSE,        -- Has user seen the popup

    PRIMARY KEY (user_id, achievement_id)
);

CREATE INDEX idx_user_achievements_user ON scoring.user_achievements (user_id, unlocked_at DESC);
CREATE INDEX idx_user_achievements_unseen ON scoring.user_achievements (user_id) WHERE displayed = FALSE;

-- ---------------------------------------------------------------------------
-- Rank Tier Definitions
-- ---------------------------------------------------------------------------
CREATE TABLE scoring.rank_tiers (
    code            TEXT PRIMARY KEY,                      -- noob|script_kiddie|hacker|...
    name            TEXT NOT NULL,
    name_color_hex  CHAR(7),
    icon_url        TEXT,
    sort_order      INT NOT NULL,
    min_points      BIGINT NOT NULL,                       -- Minimum points to enter this tier
    description     TEXT
);

-- Seed standard ranks (HTB-style)
INSERT INTO scoring.rank_tiers (code, name, sort_order, min_points, description) VALUES
    ('noob', 'Noob', 1, 0, 'Starting out'),
    ('script_kiddie', 'Script Kiddie', 2, 100, 'Learning the basics'),
    ('hacker', 'Hacker', 3, 500, 'Getting comfortable'),
    ('pro_hacker', 'Pro Hacker', 4, 2000, 'Skilled and consistent'),
    ('elite_hacker', 'Elite Hacker', 5, 5000, 'Top tier'),
    ('guru', 'Guru', 6, 10000, 'Mastery achieved'),
    ('omniscient', 'Omniscient', 7, 25000, 'Apex predator');

-- ---------------------------------------------------------------------------
-- Anti-Cheat Flags (separate audit table for suspicious activity)
-- ---------------------------------------------------------------------------
CREATE TABLE scoring.cheat_flags (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL,
    flag_type       TEXT NOT NULL,                         -- shared_flag|impossible_speed|bot_pattern|multi_account|writeup_leak
    severity        TEXT NOT NULL,                         -- low|medium|high|critical
    confidence      NUMERIC(5,2) NOT NULL,                 -- 0-100
    evidence        JSONB NOT NULL,                        -- Details
    submission_ids  UUID[] DEFAULT '{}',
    status          TEXT NOT NULL DEFAULT 'pending',       -- pending|reviewing|confirmed|dismissed|appealed
    reviewer_id     UUID,
    review_notes    TEXT,
    action_taken    TEXT,                                  -- none|warning|points_revoked|suspended|banned
    detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at     TIMESTAMPTZ,

    CONSTRAINT chk_cheat_severity CHECK (severity IN ('low','medium','high','critical')),
    CONSTRAINT chk_cheat_status CHECK (status IN ('pending','reviewing','confirmed','dismissed','appealed'))
);

CREATE INDEX idx_cheat_flags_user ON scoring.cheat_flags (user_id, detected_at DESC);
CREATE INDEX idx_cheat_flags_status ON scoring.cheat_flags (status, severity DESC, detected_at) WHERE status IN ('pending','reviewing');
