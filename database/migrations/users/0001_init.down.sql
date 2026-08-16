-- Users schema rollback
DROP TABLE IF EXISTS users.vpn_configs CASCADE;
DROP TABLE IF EXISTS users.activity CASCADE;
DROP TABLE IF EXISTS users.subscriptions CASCADE;
DROP TABLE IF EXISTS users.team_invitations CASCADE;
DROP TABLE IF EXISTS users.team_members CASCADE;
DROP TABLE IF EXISTS users.teams CASCADE;
DROP TABLE IF EXISTS users.preferences CASCADE;
DROP TABLE IF EXISTS users.profiles CASCADE;
