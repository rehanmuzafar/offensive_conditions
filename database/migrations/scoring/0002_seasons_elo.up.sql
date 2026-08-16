-- =============================================================================
-- Scoring Schema — Migration 0002: Seasons & ELO Ratings
-- =============================================================================
-- Adds seasonal leaderboards and PvP ELO rating system.
-- The initial schema (0001) has user_scores, owns, achievements, etc.
-- =============================================================================

SET search_path = scoring, public;

-- ---------------------------------------------------------------------------
-- Seasons (quarterly competitive periods, HTB-style)
-- ---------------------------------------------------------------------------
CREATE TABLE scoring.seasons (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            TEXT NOT NULL UNIQUE,                     -- e.g. "2026-Q1"
    name            TEXT NOT NULL,                            -- "Spring 2026"
    starts_at       TIMESTAMPTZ NOT NULL,
    ends_at         TIMESTAMPTZ NOT NULL,
    state           TEXT NOT NULL DEFAULT 'upcoming',         -- upcoming|active|ended|archived
    -- Carry-over policy
    carryover_fraction NUMERIC(4,3) NOT NULL DEFAULT 0.250,   -- 25% of points carry to next season
    -- Rewards
    rewards         JSONB NOT NULL DEFAULT '{}'::JSONB,       -- {top_1_pct: {badge: ..., points: ...}}
    -- Rollover
    rolled_over_at  TIMESTAMPTZ,
    snapshot_id     UUID,                                     -- Link to season_snapshots
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_seasons_state CHECK (state IN ('upcoming','active','ended','archived')),
    CONSTRAINT chk_seasons_dates CHECK (ends_at > starts_at)
);

CREATE INDEX idx_seasons_state ON scoring.seasons (state, starts_at DESC);
CREATE INDEX idx_seasons_active ON scoring.seasons (starts_at, ends_at) WHERE state = 'active';

CREATE TRIGGER trg_seasons_updated_at
    BEFORE UPDATE ON scoring.seasons
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Season User Scores (per-season totals; user_scores is all-time)
-- ---------------------------------------------------------------------------
CREATE TABLE scoring.season_user_scores (
    season_id       UUID NOT NULL REFERENCES scoring.seasons(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL,
    total_points    BIGINT NOT NULL DEFAULT 0,
    machine_points  BIGINT NOT NULL DEFAULT 0,
    challenge_points BIGINT NOT NULL DEFAULT 0,
    ctf_points      BIGINT NOT NULL DEFAULT 0,
    bonus_points    BIGINT NOT NULL DEFAULT 0,
    machines_owned  INT NOT NULL DEFAULT 0,
    challenges_solved INT NOT NULL DEFAULT 0,
    first_bloods    INT NOT NULL DEFAULT 0,
    -- Final standing (set on rollover)
    final_rank      INT,
    final_percentile NUMERIC(5,2),                            -- 0..100
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (season_id, user_id)
);

CREATE INDEX idx_season_scores_season_points ON scoring.season_user_scores (season_id, total_points DESC);
CREATE INDEX idx_season_scores_user ON scoring.season_user_scores (user_id, season_id);

CREATE TRIGGER trg_season_user_scores_updated_at
    BEFORE UPDATE ON scoring.season_user_scores
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Season Snapshots (immutable record of final standings at rollover)
-- ---------------------------------------------------------------------------
CREATE TABLE scoring.season_snapshots (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    season_id       UUID NOT NULL REFERENCES scoring.seasons(id),
    user_id         UUID NOT NULL,
    final_rank      INT NOT NULL,
    final_points    BIGINT NOT NULL,
    percentile      NUMERIC(5,2) NOT NULL,
    rewards_granted JSONB NOT NULL DEFAULT '{}'::JSONB,
    captured_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_snapshot_season_user UNIQUE (season_id, user_id)
);

CREATE INDEX idx_season_snapshots_season_rank ON scoring.season_snapshots (season_id, final_rank);
CREATE INDEX idx_season_snapshots_user ON scoring.season_snapshots (user_id);

-- ---------------------------------------------------------------------------
-- ELO Ratings (PvP CTF)
-- ---------------------------------------------------------------------------
CREATE TABLE scoring.elo_ratings (
    user_id         UUID PRIMARY KEY,
    rating          INT NOT NULL DEFAULT 1500,                -- Standard ELO starting point
    peak_rating     INT NOT NULL DEFAULT 1500,
    matches_played  INT NOT NULL DEFAULT 0,
    wins            INT NOT NULL DEFAULT 0,
    losses          INT NOT NULL DEFAULT 0,
    draws           INT NOT NULL DEFAULT 0,
    last_match_at   TIMESTAMPTZ,
    -- Decay tracking
    last_decay_at   TIMESTAMPTZ,
    is_provisional  BOOLEAN NOT NULL DEFAULT TRUE,            -- True for first 10 matches (volatile K)
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_elo_ratings_rating ON scoring.elo_ratings (rating DESC);
CREATE INDEX idx_elo_ratings_active ON scoring.elo_ratings (last_match_at DESC) WHERE matches_played > 0;

CREATE TRIGGER trg_elo_ratings_updated_at
    BEFORE UPDATE ON scoring.elo_ratings
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- ELO Match History
-- ---------------------------------------------------------------------------
CREATE TABLE scoring.elo_matches (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id        UUID NOT NULL,                            -- External CTF match id
    player_a_id     UUID NOT NULL,
    player_b_id     UUID NOT NULL,
    -- Pre-match ratings
    player_a_rating_before INT NOT NULL,
    player_b_rating_before INT NOT NULL,
    -- Result (a's perspective): 1 = a won, 0.5 = draw, 0 = b won
    result          NUMERIC(2,1) NOT NULL,
    -- Post-match ratings
    player_a_rating_after  INT NOT NULL,
    player_b_rating_after  INT NOT NULL,
    rating_delta    INT NOT NULL,                             -- |after - before| for player a
    k_factor        INT NOT NULL,
    match_duration_seconds INT,
    completed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_elo_match_result CHECK (result IN (0, 0.5, 1)),
    CONSTRAINT chk_elo_match_players CHECK (player_a_id != player_b_id)
);

CREATE INDEX idx_elo_matches_player_a ON scoring.elo_matches (player_a_id, completed_at DESC);
CREATE INDEX idx_elo_matches_player_b ON scoring.elo_matches (player_b_id, completed_at DESC);
CREATE INDEX idx_elo_matches_match ON scoring.elo_matches (match_id);

-- ---------------------------------------------------------------------------
-- Daily Streaks (denormalized, hot path on submission)
-- ---------------------------------------------------------------------------
CREATE TABLE scoring.daily_activity (
    user_id         UUID NOT NULL,
    activity_date   DATE NOT NULL,
    points_earned   BIGINT NOT NULL DEFAULT 0,
    solves_count    INT NOT NULL DEFAULT 0,
    first_solve_at  TIMESTAMPTZ,
    last_solve_at   TIMESTAMPTZ,

    PRIMARY KEY (user_id, activity_date)
);

CREATE INDEX idx_daily_activity_date ON scoring.daily_activity (activity_date DESC);

-- ---------------------------------------------------------------------------
-- Seed: current season
-- ---------------------------------------------------------------------------
INSERT INTO scoring.seasons (code, name, starts_at, ends_at, state, carryover_fraction)
VALUES (
    '2026-Q2',
    'Spring 2026',
    date_trunc('quarter', NOW()),
    date_trunc('quarter', NOW()) + INTERVAL '3 months',
    'active',
    0.250
)
ON CONFLICT (code) DO NOTHING;
