-- =============================================================================
-- users — auto-provision a profile when an account is created
-- =============================================================================
-- INTERIM FIX. The intended design (ARCHITECTURE.md §4.2) is: auth publishes
-- `auth.user.registered` to Kafka and user-svc's worker (services/user-svc/
-- cmd/worker) consumes it and creates the profile. That consumer exists, but
-- auth has no Kafka producer at all and the worker is not run by the deploy
-- stack, so no profile was ever created and GET /v1/users/me returned
-- USER_NOT_FOUND for every account.
--
-- This trigger closes the gap so registration works end to end. It relies on
-- auth and users sharing one database, which is true for this deployment but
-- is NOT the long-term design — remove it once auth publishes the event.
-- =============================================================================

CREATE OR REPLACE FUNCTION users.create_profile_for_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO users.profiles (user_id, display_name)
    VALUES (NEW.id, NEW.username)
    ON CONFLICT (user_id) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_profile_for_new_user ON auth.users;
CREATE TRIGGER trg_create_profile_for_new_user
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION users.create_profile_for_new_user();

-- Backfill accounts registered before this trigger existed.
INSERT INTO users.profiles (user_id, display_name)
SELECT u.id, u.username
FROM auth.users u
LEFT JOIN users.profiles p ON p.user_id = u.id
WHERE p.user_id IS NULL;
