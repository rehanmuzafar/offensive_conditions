-- =============================================================================
-- ctf — remember who started the instance, by name
-- =============================================================================
-- `spawned_by` is a user id, and the panel that shows a team its instance has
-- no way to turn one into a name: ctf-svc does not own the user table, and a
-- per-render cross-service lookup for a single label is not worth a request.
--
-- So the name is captured at spawn time, the same way event_participants
-- captures display_name and chat_messages captures username. A teammate who
-- opens the challenge an hour later still sees "Started by <name>" instead of
-- a blank where the credit should be.
-- =============================================================================

ALTER TABLE ctf.challenge_instances
    ADD COLUMN IF NOT EXISTS spawned_by_name text;

COMMENT ON COLUMN ctf.challenge_instances.spawned_by_name IS
    'Username at spawn time. Captured so the panel needs no user lookup.';
