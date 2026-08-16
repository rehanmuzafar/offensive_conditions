-- CTF schema rollback
DROP TABLE IF EXISTS ctf.event_solves CASCADE;
DROP TABLE IF EXISTS ctf.event_participants CASCADE;
DROP TABLE IF EXISTS ctf.event_challenges CASCADE;
DROP TABLE IF EXISTS ctf.events CASCADE;
