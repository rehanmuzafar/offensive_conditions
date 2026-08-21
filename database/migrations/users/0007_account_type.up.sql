-- =============================================================================
-- users — hacker or company
-- =============================================================================
-- The platform serves two audiences that want opposite things from it. A hacker
-- wants programs to hunt, a leaderboard and an inbox of their own reports. A
-- company wants a program to run, a triage queue and hackers to invite. Which
-- one someone is decides their entire first screen, so it is asked once, at
-- first sign-in, and remembered.
--
-- Nullable on purpose: existing accounts have not been asked. NULL is the
-- signal that the onboarding question is still owed, which is cleaner than
-- defaulting everyone to 'hacker' and never asking.
-- =============================================================================

ALTER TABLE users.profiles
    ADD COLUMN IF NOT EXISTS account_type text,
    ADD COLUMN IF NOT EXISTS company_name text,
    ADD COLUMN IF NOT EXISTS company_website text;

ALTER TABLE users.profiles
    DROP CONSTRAINT IF EXISTS chk_profile_account_type;
ALTER TABLE users.profiles
    ADD CONSTRAINT chk_profile_account_type
    CHECK (account_type IS NULL OR account_type IN ('hacker', 'company'));

COMMENT ON COLUMN users.profiles.account_type IS
    'hacker | company, chosen at first sign-in. NULL means not asked yet.';
