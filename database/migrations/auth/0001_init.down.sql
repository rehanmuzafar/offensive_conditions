-- =============================================================================
-- Auth Schema — Rollback for 0001_init
-- =============================================================================

DROP TABLE IF EXISTS auth.api_keys CASCADE;
DROP TABLE IF EXISTS auth.login_attempts_2026_07 CASCADE;
DROP TABLE IF EXISTS auth.login_attempts_2026_06 CASCADE;
DROP TABLE IF EXISTS auth.login_attempts_2026_05 CASCADE;
DROP TABLE IF EXISTS auth.login_attempts CASCADE;
DROP TABLE IF EXISTS auth.password_resets CASCADE;
DROP TABLE IF EXISTS auth.email_verifications CASCADE;
DROP TABLE IF EXISTS auth.oauth_links CASCADE;
DROP TABLE IF EXISTS auth.sessions CASCADE;
DROP TABLE IF EXISTS auth.refresh_tokens CASCADE;
DROP TABLE IF EXISTS auth.tfa_secrets CASCADE;
DROP TABLE IF EXISTS auth.users CASCADE;
