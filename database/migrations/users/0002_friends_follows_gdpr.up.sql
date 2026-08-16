-- =============================================================================
-- Users schema — additions for friends, follows, GDPR
-- =============================================================================

SET search_path TO users, public;

-- Add columns to profiles for things not present in 0001
ALTER TABLE users.profiles
	ADD COLUMN IF NOT EXISTS avatar_storage_key TEXT,
	ADD COLUMN IF NOT EXISTS is_verified_human BOOLEAN NOT NULL DEFAULT FALSE,
	ADD COLUMN IF NOT EXISTS onboarding_complete BOOLEAN NOT NULL DEFAULT FALSE,
	ADD COLUMN IF NOT EXISTS profile_visibility TEXT NOT NULL DEFAULT 'public',
	ADD COLUMN IF NOT EXISTS show_team BOOLEAN NOT NULL DEFAULT TRUE,
	ADD COLUMN IF NOT EXISTS show_achievements BOOLEAN NOT NULL DEFAULT TRUE,
	ADD COLUMN IF NOT EXISTS show_on_leaderboard BOOLEAN NOT NULL DEFAULT TRUE,
	ADD COLUMN IF NOT EXISTS allow_friend_requests BOOLEAN NOT NULL DEFAULT TRUE,
	ADD COLUMN IF NOT EXISTS allow_messages TEXT NOT NULL DEFAULT 'anyone';

ALTER TABLE users.profiles
	DROP CONSTRAINT IF EXISTS chk_profile_visibility;
ALTER TABLE users.profiles
	ADD CONSTRAINT chk_profile_visibility CHECK (profile_visibility IN ('public','friends_only','private'));

ALTER TABLE users.profiles
	DROP CONSTRAINT IF EXISTS chk_allow_messages;
ALTER TABLE users.profiles
	ADD CONSTRAINT chk_allow_messages CHECK (allow_messages IN ('anyone','friends_only','nobody'));

-- Add last_seen_at to auth.users (used for "online now" badges and inactivity detection)
ALTER TABLE auth.users
	ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_last_seen ON auth.users(last_seen_at DESC) WHERE last_seen_at IS NOT NULL;

-- Friend requests
CREATE TABLE IF NOT EXISTS users.friend_requests (
	id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	requester_id    UUID NOT NULL,
	receiver_id     UUID NOT NULL,
	status          TEXT NOT NULL DEFAULT 'pending',
	message         TEXT,
	created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	responded_at    TIMESTAMPTZ,
	expires_at      TIMESTAMPTZ NOT NULL,

	CONSTRAINT chk_fr_status CHECK (status IN ('pending','accepted','declined','cancelled','expired')),
	CONSTRAINT chk_fr_self CHECK (requester_id <> receiver_id),
	-- Only one pending request between two users (in either direction)
	CONSTRAINT uq_fr_pending_pair UNIQUE NULLS DISTINCT (requester_id, receiver_id, status)
);

CREATE INDEX IF NOT EXISTS idx_fr_receiver_status ON users.friend_requests(receiver_id, status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_fr_requester_status ON users.friend_requests(requester_id, status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_fr_expires ON users.friend_requests(expires_at) WHERE status = 'pending';

-- Friendships (canonical (a, b) ordering, a < b)
CREATE TABLE IF NOT EXISTS users.friendships (
	user_id_a       UUID NOT NULL,
	user_id_b       UUID NOT NULL,
	created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

	PRIMARY KEY (user_id_a, user_id_b),
	CONSTRAINT chk_friendship_order CHECK (user_id_a < user_id_b)
);

-- Reverse-direction index for "list all friends of X"
CREATE INDEX IF NOT EXISTS idx_friendships_b ON users.friendships(user_id_b, user_id_a);

-- Blocks (asymmetric)
CREATE TABLE IF NOT EXISTS users.user_blocks (
	blocker_id      UUID NOT NULL,
	blocked_id      UUID NOT NULL,
	reason          TEXT,
	created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

	PRIMARY KEY (blocker_id, blocked_id),
	CONSTRAINT chk_block_self CHECK (blocker_id <> blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON users.user_blocks(blocked_id);

-- Follows (asymmetric, no approval)
CREATE TABLE IF NOT EXISTS users.follows (
	follower_id     UUID NOT NULL,
	following_id    UUID NOT NULL,
	created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

	PRIMARY KEY (follower_id, following_id),
	CONSTRAINT chk_follow_self CHECK (follower_id <> following_id)
);

CREATE INDEX IF NOT EXISTS idx_follows_following ON users.follows(following_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_follows_follower ON users.follows(follower_id, created_at DESC);

-- GDPR: deletion requests
CREATE TABLE IF NOT EXISTS users.deletion_requests (
	user_id         UUID PRIMARY KEY,
	status          TEXT NOT NULL DEFAULT 'pending',
	scheduled_at    TIMESTAMPTZ NOT NULL,
	requested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	completed_at    TIMESTAMPTZ,

	CONSTRAINT chk_deletion_status CHECK (status IN ('pending','cancelled','completed'))
);

CREATE INDEX IF NOT EXISTS idx_deletion_due ON users.deletion_requests(scheduled_at) WHERE status = 'pending';

-- GDPR: data exports
CREATE TABLE IF NOT EXISTS users.data_exports (
	id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id         UUID NOT NULL,
	status          TEXT NOT NULL DEFAULT 'pending',
	storage_key     TEXT,
	size_bytes      BIGINT,
	error_msg       TEXT,
	created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	completed_at    TIMESTAMPTZ,
	expires_at      TIMESTAMPTZ NOT NULL,

	CONSTRAINT chk_export_status CHECK (status IN ('pending','processing','completed','failed'))
);

CREATE INDEX IF NOT EXISTS idx_exports_user ON users.data_exports(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_exports_status ON users.data_exports(status, created_at) WHERE status IN ('pending','processing');
CREATE INDEX IF NOT EXISTS idx_exports_expired ON users.data_exports(expires_at) WHERE status = 'completed';

-- Username search: trigram index on auth.users.username (if not already there)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_users_username_trgm
	ON auth.users USING gin (username gin_trgm_ops);

-- Comments
COMMENT ON TABLE users.friend_requests IS 'Bidirectional friendship requests with TTL';
COMMENT ON TABLE users.friendships IS 'Confirmed friendships, stored once with (a, b) where a < b';
COMMENT ON TABLE users.user_blocks IS 'Asymmetric blocking relationships';
COMMENT ON TABLE users.follows IS 'Asymmetric following (for activity feeds)';
COMMENT ON TABLE users.deletion_requests IS 'GDPR right-to-erasure requests with 30-day grace';
COMMENT ON TABLE users.data_exports IS 'GDPR data export jobs and their MinIO storage keys';
