-- =============================================================================
-- Auth Schema — Initial Migration
-- =============================================================================
-- Handles: user accounts, password storage, sessions, refresh tokens,
--          OAuth links, 2FA secrets, password reset, email verification
-- =============================================================================

SET search_path = auth, public;

-- ---------------------------------------------------------------------------
-- Users (core authentication entity)
-- ---------------------------------------------------------------------------
CREATE TABLE auth.users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           CITEXT NOT NULL UNIQUE,
    username        CITEXT NOT NULL UNIQUE,
    password_hash   TEXT,                                  -- NULL for OAuth-only accounts
    email_verified  BOOLEAN NOT NULL DEFAULT FALSE,
    tfa_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
    status          TEXT NOT NULL DEFAULT 'pending',       -- pending|active|suspended|banned|deleted
    role            TEXT NOT NULL DEFAULT 'user',          -- user|admin|moderator|content_creator|support
    failed_login_count INT NOT NULL DEFAULT 0,
    locked_until    TIMESTAMPTZ,
    last_login_at   TIMESTAMPTZ,
    last_login_ip   INET,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,

    CONSTRAINT chk_users_status CHECK (status IN ('pending','active','suspended','banned','deleted')),
    CONSTRAINT chk_users_role   CHECK (role IN ('user','admin','moderator','content_creator','support')),
    CONSTRAINT chk_username_format CHECK (username ~ '^[a-zA-Z0-9_-]{3,32}$')
);

CREATE INDEX idx_users_email ON auth.users (email) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_username ON auth.users (username) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_status ON auth.users (status) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_created_at ON auth.users (created_at DESC);

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE  auth.users IS 'Core user authentication records';
COMMENT ON COLUMN auth.users.password_hash IS 'Argon2id hash. NULL only for OAuth-only accounts';
COMMENT ON COLUMN auth.users.status IS 'pending=awaiting email verify, active, suspended=temporary, banned=permanent, deleted=soft-deleted';

-- ---------------------------------------------------------------------------
-- 2FA Secrets (separate table for security — encrypted at rest via app layer)
-- ---------------------------------------------------------------------------
CREATE TABLE auth.tfa_secrets (
    user_id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    secret_encrypted TEXT NOT NULL,                        -- AES-256-GCM via Vault transit
    backup_codes_encrypted TEXT NOT NULL,                  -- 10 single-use codes
    method          TEXT NOT NULL DEFAULT 'totp',          -- totp|webauthn (future)
    confirmed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_tfa_method CHECK (method IN ('totp','webauthn'))
);

CREATE TRIGGER trg_tfa_secrets_updated_at
    BEFORE UPDATE ON auth.tfa_secrets
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Refresh Tokens (rotating, hashed)
-- ---------------------------------------------------------------------------
CREATE TABLE auth.refresh_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    token_hash      TEXT NOT NULL,                         -- SHA-256 of actual token
    family_id       UUID NOT NULL,                         -- Token rotation chain
    parent_token_id UUID REFERENCES auth.refresh_tokens(id),
    user_agent      TEXT,
    ip_address      INET,
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked         BOOLEAN NOT NULL DEFAULT FALSE,
    revoked_at      TIMESTAMPTZ,
    revoked_reason  TEXT,                                  -- logout|rotation|theft_suspected|expired
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_refresh_tokens_hash ON auth.refresh_tokens (token_hash);
CREATE INDEX idx_refresh_tokens_user ON auth.refresh_tokens (user_id) WHERE revoked = FALSE;
CREATE INDEX idx_refresh_tokens_family ON auth.refresh_tokens (family_id);
CREATE INDEX idx_refresh_tokens_expires ON auth.refresh_tokens (expires_at) WHERE revoked = FALSE;

COMMENT ON TABLE  auth.refresh_tokens IS 'Refresh token rotation chain. Detect theft via family reuse';
COMMENT ON COLUMN auth.refresh_tokens.family_id IS 'Same family for rotated tokens. If old token used after rotation, mark entire family compromised';

-- ---------------------------------------------------------------------------
-- Active Sessions (denormalized for fast lookup)
-- ---------------------------------------------------------------------------
CREATE TABLE auth.sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    refresh_token_id UUID REFERENCES auth.refresh_tokens(id),
    device_fingerprint TEXT,
    user_agent      TEXT,
    ip_address      INET,
    country_code    CHAR(2),
    city            TEXT,
    is_current      BOOLEAN NOT NULL DEFAULT TRUE,
    last_active_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_sessions_user ON auth.sessions (user_id) WHERE is_current = TRUE;
CREATE INDEX idx_sessions_expires ON auth.sessions (expires_at);
CREATE INDEX idx_sessions_last_active ON auth.sessions (last_active_at DESC);

-- ---------------------------------------------------------------------------
-- OAuth Provider Links
-- ---------------------------------------------------------------------------
CREATE TABLE auth.oauth_links (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    provider        TEXT NOT NULL,                         -- google|github|discord|microsoft
    provider_user_id TEXT NOT NULL,
    provider_email  CITEXT,
    access_token_encrypted TEXT,                           -- Optional, for API calls
    refresh_token_encrypted TEXT,
    metadata        JSONB DEFAULT '{}'::JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_oauth_provider CHECK (provider IN ('google','github','discord','microsoft')),
    CONSTRAINT uq_oauth_provider_user UNIQUE (provider, provider_user_id)
);

CREATE INDEX idx_oauth_user ON auth.oauth_links (user_id);

CREATE TRIGGER trg_oauth_links_updated_at
    BEFORE UPDATE ON auth.oauth_links
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Email Verification Tokens
-- ---------------------------------------------------------------------------
CREATE TABLE auth.email_verifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    token_hash      TEXT NOT NULL,
    email           CITEXT NOT NULL,                       -- The email being verified
    expires_at      TIMESTAMPTZ NOT NULL,
    used_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_email_verif_token ON auth.email_verifications (token_hash);
CREATE INDEX idx_email_verif_user ON auth.email_verifications (user_id) WHERE used_at IS NULL;

-- ---------------------------------------------------------------------------
-- Password Reset Tokens
-- ---------------------------------------------------------------------------
CREATE TABLE auth.password_resets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    token_hash      TEXT NOT NULL,
    ip_address      INET,
    expires_at      TIMESTAMPTZ NOT NULL,
    used_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_pwd_reset_token ON auth.password_resets (token_hash);
CREATE INDEX idx_pwd_reset_user ON auth.password_resets (user_id) WHERE used_at IS NULL;

-- ---------------------------------------------------------------------------
-- Login Attempts (for rate limiting and suspicious activity detection)
-- ---------------------------------------------------------------------------
CREATE TABLE auth.login_attempts (
    id              UUID NOT NULL DEFAULT public.uuid_generate_v7(),
    user_id         UUID,                                  -- NULL if user not found
    email_attempted CITEXT,
    success         BOOLEAN NOT NULL,
    failure_reason  TEXT,                                  -- bad_password|account_locked|2fa_failed|email_not_found
    ip_address      INET NOT NULL,
    user_agent      TEXT,
    country_code    CHAR(2),
    attempted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (id, attempted_at)
) PARTITION BY RANGE (attempted_at);

-- Create initial partitions (monthly)
CREATE TABLE auth.login_attempts_2026_05 PARTITION OF auth.login_attempts
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE auth.login_attempts_2026_06 PARTITION OF auth.login_attempts
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE auth.login_attempts_2026_07 PARTITION OF auth.login_attempts
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

CREATE INDEX idx_login_attempts_ip ON auth.login_attempts (ip_address, attempted_at DESC);
CREATE INDEX idx_login_attempts_email ON auth.login_attempts (email_attempted, attempted_at DESC);
CREATE INDEX idx_login_attempts_user ON auth.login_attempts (user_id, attempted_at DESC);

COMMENT ON TABLE auth.login_attempts IS 'Partitioned by month. Set up pg_partman for automation.';

-- ---------------------------------------------------------------------------
-- API Keys (for users/teams accessing API programmatically)
-- ---------------------------------------------------------------------------
CREATE TABLE auth.api_keys (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,                         -- User-defined label
    key_prefix      TEXT NOT NULL,                         -- First 8 chars for display: "offcon_abc12345"
    key_hash        TEXT NOT NULL,                         -- SHA-256 of full key
    scopes          TEXT[] NOT NULL DEFAULT '{}',
    last_used_at    TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ,                           -- NULL = never expires
    revoked         BOOLEAN NOT NULL DEFAULT FALSE,
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_api_keys_hash ON auth.api_keys (key_hash);
CREATE INDEX idx_api_keys_user ON auth.api_keys (user_id) WHERE revoked = FALSE;
CREATE INDEX idx_api_keys_prefix ON auth.api_keys (key_prefix);
