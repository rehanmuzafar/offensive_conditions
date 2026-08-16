-- =============================================================================
-- users — rename the team owner role to "captain"
-- =============================================================================
-- The code already assumed this name: TeamMembership documents the role as
-- "captain | member" and ListMembers sorts by `role = 'captain'` — a sort that
-- never matched anything, because creation actually inserted 'owner'. Settling
-- on the name the rest of the code (and the UI) expects makes that ordering
-- work and matches what players call the role.
-- =============================================================================

ALTER TABLE users.team_members DROP CONSTRAINT IF EXISTS chk_team_role;
ALTER TABLE users.team_members ADD CONSTRAINT chk_team_role
    CHECK (role IN ('captain', 'owner', 'admin', 'member'));

UPDATE users.team_members SET role = 'captain' WHERE role = 'owner';
