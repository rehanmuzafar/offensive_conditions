UPDATE users.team_members SET role = 'owner' WHERE role = 'captain';
ALTER TABLE users.team_members DROP CONSTRAINT IF EXISTS chk_team_role;
ALTER TABLE users.team_members ADD CONSTRAINT chk_team_role
    CHECK (role IN ('owner', 'admin', 'member'));
