-- =============================================================================
-- Users Schema — Initial Migration
-- =============================================================================
-- Handles: profiles, preferences, teams, team membership, subscriptions
-- Note: user_id references auth.users.id but no FK across schemas (eventual consistency)
-- =============================================================================

SET search_path = users, public;

-- ---------------------------------------------------------------------------
-- Profiles (extended user data, public-facing)
-- ---------------------------------------------------------------------------
CREATE TABLE users.profiles (
    user_id         UUID PRIMARY KEY,                      -- mirrors auth.users.id
    display_name    TEXT,
    bio             TEXT,
    avatar_url      TEXT,
    banner_url      TEXT,
    country_code    CHAR(2),
    timezone        TEXT DEFAULT 'UTC',
    language        TEXT DEFAULT 'en',                     -- en|ur|ar|...
    -- Social handles
    github_handle   TEXT,
    twitter_handle  TEXT,
    linkedin_url    TEXT,
    discord_handle  TEXT,
    website_url     TEXT,
    -- Privacy
    public_profile  BOOLEAN NOT NULL DEFAULT TRUE,
    show_country    BOOLEAN NOT NULL DEFAULT TRUE,
    show_rank       BOOLEAN NOT NULL DEFAULT TRUE,
    show_activity   BOOLEAN NOT NULL DEFAULT TRUE,
    -- Misc
    pronouns        TEXT,
    occupation      TEXT,
    metadata        JSONB DEFAULT '{}'::JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_country_code CHECK (country_code ~ '^[A-Z]{2}$' OR country_code IS NULL),
    CONSTRAINT chk_language CHECK (language IN ('en','ur','ar','es','fr','de','zh','ja','ko','pt','ru','tr','hi','id'))
);

CREATE INDEX idx_profiles_country ON users.profiles (country_code) WHERE public_profile = TRUE;
CREATE INDEX idx_profiles_display_name ON users.profiles USING GIN (display_name gin_trgm_ops) WHERE public_profile = TRUE;

CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON users.profiles
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Preferences (private user settings)
-- ---------------------------------------------------------------------------
CREATE TABLE users.preferences (
    user_id         UUID PRIMARY KEY,
    -- Notifications
    notify_email_machines     BOOLEAN NOT NULL DEFAULT TRUE,
    notify_email_ctf          BOOLEAN NOT NULL DEFAULT TRUE,
    notify_email_marketing    BOOLEAN NOT NULL DEFAULT FALSE,
    notify_email_security     BOOLEAN NOT NULL DEFAULT TRUE,    -- always on, can disable via legal exception
    notify_push_enabled       BOOLEAN NOT NULL DEFAULT TRUE,
    notify_inapp_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
    -- UI
    theme                     TEXT NOT NULL DEFAULT 'dark',     -- dark|light|system
    terminal_theme            TEXT NOT NULL DEFAULT 'monokai',
    code_font                 TEXT DEFAULT 'JetBrains Mono',
    -- Privacy
    appear_offline            BOOLEAN NOT NULL DEFAULT FALSE,
    allow_team_invites        BOOLEAN NOT NULL DEFAULT TRUE,
    allow_dms                 TEXT NOT NULL DEFAULT 'team_members',  -- everyone|team_members|none
    -- Misc
    default_vpn_region        TEXT,
    metadata                  JSONB DEFAULT '{}'::JSONB,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_theme CHECK (theme IN ('dark','light','system')),
    CONSTRAINT chk_dms CHECK (allow_dms IN ('everyone','team_members','none'))
);

CREATE TRIGGER trg_preferences_updated_at
    BEFORE UPDATE ON users.preferences
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Teams
-- ---------------------------------------------------------------------------
CREATE TABLE users.teams (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    slug            CITEXT NOT NULL UNIQUE,
    description     TEXT,
    avatar_url      TEXT,
    banner_url      TEXT,
    country_code    CHAR(2),
    is_private      BOOLEAN NOT NULL DEFAULT FALSE,
    is_recruiting   BOOLEAN NOT NULL DEFAULT TRUE,
    owner_id        UUID NOT NULL,                         -- mirrors auth.users.id
    max_members     INT NOT NULL DEFAULT 10,               -- Tier-dependent
    total_points    BIGINT NOT NULL DEFAULT 0,             -- Denormalized for ranking
    member_count    INT NOT NULL DEFAULT 1,                -- Includes owner
    status          TEXT NOT NULL DEFAULT 'active',        -- active|disbanded|suspended
    metadata        JSONB DEFAULT '{}'::JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    disbanded_at    TIMESTAMPTZ,

    CONSTRAINT chk_team_slug CHECK (slug ~ '^[a-z0-9-]{3,32}$'),
    CONSTRAINT chk_team_status CHECK (status IN ('active','disbanded','suspended'))
);

CREATE INDEX idx_teams_owner ON users.teams (owner_id);
CREATE INDEX idx_teams_status ON users.teams (status) WHERE status = 'active';
CREATE INDEX idx_teams_points ON users.teams (total_points DESC) WHERE status = 'active';
CREATE INDEX idx_teams_country ON users.teams (country_code) WHERE status = 'active';
CREATE INDEX idx_teams_name_trgm ON users.teams USING GIN (name gin_trgm_ops);

CREATE TRIGGER trg_teams_updated_at
    BEFORE UPDATE ON users.teams
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Team Members
-- ---------------------------------------------------------------------------
CREATE TABLE users.team_members (
    team_id         UUID NOT NULL REFERENCES users.teams(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL,
    role            TEXT NOT NULL DEFAULT 'member',        -- owner|admin|member
    nickname        TEXT,
    contribution_points BIGINT NOT NULL DEFAULT 0,         -- Points contributed to team
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    left_at         TIMESTAMPTZ,

    PRIMARY KEY (team_id, user_id),
    CONSTRAINT chk_team_role CHECK (role IN ('owner','admin','member'))
);

CREATE INDEX idx_team_members_user ON users.team_members (user_id) WHERE left_at IS NULL;
CREATE INDEX idx_team_members_team_role ON users.team_members (team_id, role) WHERE left_at IS NULL;

-- ---------------------------------------------------------------------------
-- Team Invitations
-- ---------------------------------------------------------------------------
CREATE TABLE users.team_invitations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id         UUID NOT NULL REFERENCES users.teams(id) ON DELETE CASCADE,
    inviter_id      UUID NOT NULL,
    invitee_id      UUID,                                  -- NULL if email-based
    invitee_email   CITEXT,
    token_hash      TEXT NOT NULL UNIQUE,
    status          TEXT NOT NULL DEFAULT 'pending',       -- pending|accepted|declined|expired|revoked
    message         TEXT,
    expires_at      TIMESTAMPTZ NOT NULL,
    responded_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_invitation_target CHECK (invitee_id IS NOT NULL OR invitee_email IS NOT NULL),
    CONSTRAINT chk_invitation_status CHECK (status IN ('pending','accepted','declined','expired','revoked'))
);

CREATE INDEX idx_invitations_team ON users.team_invitations (team_id);
CREATE INDEX idx_invitations_invitee ON users.team_invitations (invitee_id) WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- Subscriptions (current state per user)
-- ---------------------------------------------------------------------------
CREATE TABLE users.subscriptions (
    user_id                 UUID PRIMARY KEY,
    tier                    TEXT NOT NULL DEFAULT 'free',  -- free|vip|vip_plus|team|enterprise
    status                  TEXT NOT NULL DEFAULT 'active',-- active|past_due|canceled|expired|trial
    billing_cycle           TEXT,                          -- monthly|annual|lifetime
    current_period_start    TIMESTAMPTZ,
    current_period_end      TIMESTAMPTZ,
    trial_ends_at           TIMESTAMPTZ,
    cancel_at_period_end    BOOLEAN NOT NULL DEFAULT FALSE,
    canceled_at             TIMESTAMPTZ,
    -- External payment provider IDs (denormalized for quick lookup; details in payment schema)
    stripe_customer_id      TEXT,
    stripe_subscription_id  TEXT,
    -- Tier-derived limits cached for fast quota checks
    max_concurrent_instances INT NOT NULL DEFAULT 2,
    max_daily_spawns         INT NOT NULL DEFAULT 10,
    pro_labs_access          BOOLEAN NOT NULL DEFAULT FALSE,
    pwnbox_access            BOOLEAN NOT NULL DEFAULT FALSE,
    advanced_analytics       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_sub_tier CHECK (tier IN ('free','vip','vip_plus','team','enterprise')),
    CONSTRAINT chk_sub_status CHECK (status IN ('active','past_due','canceled','expired','trial')),
    CONSTRAINT chk_billing_cycle CHECK (billing_cycle IS NULL OR billing_cycle IN ('monthly','annual','lifetime'))
);

CREATE INDEX idx_subscriptions_status ON users.subscriptions (status);
CREATE INDEX idx_subscriptions_period_end ON users.subscriptions (current_period_end) WHERE status IN ('active','past_due');
CREATE INDEX idx_subscriptions_stripe ON users.subscriptions (stripe_customer_id);

CREATE TRIGGER trg_subscriptions_updated_at
    BEFORE UPDATE ON users.subscriptions
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Activity Tracking (last seen, presence)
-- ---------------------------------------------------------------------------
CREATE TABLE users.activity (
    user_id         UUID PRIMARY KEY,
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_ip    INET,
    online_status   TEXT NOT NULL DEFAULT 'offline',       -- online|away|offline|invisible
    current_focus   TEXT,                                  -- e.g. "Solving machine: Blue"
    total_login_count BIGINT NOT NULL DEFAULT 0,
    total_time_spent_minutes BIGINT NOT NULL DEFAULT 0,
    streak_days     INT NOT NULL DEFAULT 0,
    longest_streak_days INT NOT NULL DEFAULT 0,
    last_streak_date DATE,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_online_status CHECK (online_status IN ('online','away','offline','invisible'))
);

CREATE INDEX idx_activity_online ON users.activity (online_status) WHERE online_status IN ('online','away');
CREATE INDEX idx_activity_last_seen ON users.activity (last_seen_at DESC);

CREATE TRIGGER trg_activity_updated_at
    BEFORE UPDATE ON users.activity
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- VPN Configurations (per-user WireGuard keys)
-- ---------------------------------------------------------------------------
CREATE TABLE users.vpn_configs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL,
    region          TEXT NOT NULL,                         -- us-east|eu-central|asia-south
    public_key      TEXT NOT NULL,                         -- WireGuard pubkey
    private_key_encrypted TEXT NOT NULL,                   -- Encrypted with KMS for display once
    assigned_ip     INET NOT NULL,                         -- 10.100.X.Y/32
    config_name     TEXT,                                  -- User label: "Home", "Office"
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    last_handshake_at TIMESTAMPTZ,
    bytes_sent      BIGINT DEFAULT 0,
    bytes_received  BIGINT DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at      TIMESTAMPTZ,

    CONSTRAINT chk_vpn_region CHECK (region IN ('us-east','eu-central','asia-south','pak-local'))
);

CREATE INDEX idx_vpn_user ON users.vpn_configs (user_id) WHERE is_active = TRUE;
CREATE UNIQUE INDEX idx_vpn_public_key ON users.vpn_configs (public_key) WHERE is_active = TRUE;
CREATE UNIQUE INDEX idx_vpn_assigned_ip ON users.vpn_configs (assigned_ip) WHERE is_active = TRUE;

COMMENT ON TABLE users.vpn_configs IS 'WireGuard configurations. private_key only shown to user once at creation';
