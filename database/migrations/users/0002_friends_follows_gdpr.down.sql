SET search_path TO users, public;

DROP TABLE IF EXISTS users.data_exports;
DROP TABLE IF EXISTS users.deletion_requests;
DROP TABLE IF EXISTS users.follows;
DROP TABLE IF EXISTS users.user_blocks;
DROP TABLE IF EXISTS users.friendships;
DROP TABLE IF EXISTS users.friend_requests;

ALTER TABLE users.profiles
	DROP CONSTRAINT IF EXISTS chk_allow_messages,
	DROP CONSTRAINT IF EXISTS chk_profile_visibility;

ALTER TABLE users.profiles
	DROP COLUMN IF EXISTS allow_messages,
	DROP COLUMN IF EXISTS allow_friend_requests,
	DROP COLUMN IF EXISTS show_on_leaderboard,
	DROP COLUMN IF EXISTS show_achievements,
	DROP COLUMN IF EXISTS show_team,
	DROP COLUMN IF EXISTS profile_visibility,
	DROP COLUMN IF EXISTS onboarding_complete,
	DROP COLUMN IF EXISTS is_verified_human,
	DROP COLUMN IF EXISTS avatar_storage_key;

DROP INDEX IF EXISTS auth.idx_users_username_trgm;
