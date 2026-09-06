-- =============================================================================
-- Offensive Conditions — Cluster Initialization
-- =============================================================================
-- Run as superuser on a fresh PostgreSQL 16 cluster.
-- Creates the database, extensions, service roles, and base permissions.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Database creation (run from postgres database)
-- ---------------------------------------------------------------------------
-- CREATE DATABASE offcon
--     WITH OWNER = offcon_admin
--     ENCODING = 'UTF8'
--     LC_COLLATE = 'en_US.UTF-8'
--     LC_CTYPE = 'en_US.UTF-8'
--     TEMPLATE = template0;

-- Connect to offcon database before running below
\c offcon

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";          -- gen_random_uuid(), digest()
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";         -- uuid_generate_v7 helpers
CREATE EXTENSION IF NOT EXISTS "citext";            -- case-insensitive text
CREATE EXTENSION IF NOT EXISTS "pg_trgm";           -- trigram for fuzzy search
CREATE EXTENSION IF NOT EXISTS "btree_gin";         -- gin index on scalars
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements"; -- query performance
CREATE EXTENSION IF NOT EXISTS "unaccent";          -- accent-insensitive search

-- ---------------------------------------------------------------------------
-- Schemas (one per service)
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS users;
CREATE SCHEMA IF NOT EXISTS content;
CREATE SCHEMA IF NOT EXISTS lab;
CREATE SCHEMA IF NOT EXISTS scoring;
CREATE SCHEMA IF NOT EXISTS ctf;
CREATE SCHEMA IF NOT EXISTS forum;
CREATE SCHEMA IF NOT EXISTS writeup;
CREATE SCHEMA IF NOT EXISTS payment;
CREATE SCHEMA IF NOT EXISTS bounty;
CREATE SCHEMA IF NOT EXISTS audit;

COMMENT ON SCHEMA auth     IS 'Authentication, sessions, tokens, 2FA';
COMMENT ON SCHEMA users    IS 'User profiles, teams, subscriptions';
COMMENT ON SCHEMA content  IS 'Machines, challenges, paths, dojos';
COMMENT ON SCHEMA lab      IS 'Lab instance lifecycle, compute nodes';
COMMENT ON SCHEMA scoring  IS 'Submissions, points, achievements, leaderboards';
COMMENT ON SCHEMA ctf      IS 'CTF events, event challenges, scoreboards';
COMMENT ON SCHEMA forum    IS 'Discussion threads, posts, votes';
COMMENT ON SCHEMA writeup  IS 'User-submitted solution writeups';
COMMENT ON SCHEMA payment  IS 'Subscriptions, invoices, transactions';
COMMENT ON SCHEMA bounty   IS 'Bug bounty programs and reports';
COMMENT ON SCHEMA audit    IS 'Security and compliance audit log';

-- ---------------------------------------------------------------------------
-- Service Roles (each microservice has its own role)
-- ---------------------------------------------------------------------------
-- NOTE: Passwords are placeholders. In production, set via Vault.
-- Each service can only access its own schema.

-- Auth service
DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_auth') THEN
        CREATE ROLE svc_auth WITH LOGIN PASSWORD 'CHANGE_ME_VAULT_MANAGED';
    END IF;
END $$;

-- User service
DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_user') THEN
        CREATE ROLE svc_user WITH LOGIN PASSWORD 'CHANGE_ME_VAULT_MANAGED';
    END IF;
END $$;

-- Content service
DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_content') THEN
        CREATE ROLE svc_content WITH LOGIN PASSWORD 'CHANGE_ME_VAULT_MANAGED';
    END IF;
END $$;

-- Orchestrator service
DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_orchestrator') THEN
        CREATE ROLE svc_orchestrator WITH LOGIN PASSWORD 'CHANGE_ME_VAULT_MANAGED';
    END IF;
END $$;

-- Scoring service
DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_scoring') THEN
        CREATE ROLE svc_scoring WITH LOGIN PASSWORD 'CHANGE_ME_VAULT_MANAGED';
    END IF;
END $$;

-- CTF service
DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_ctf') THEN
        CREATE ROLE svc_ctf WITH LOGIN PASSWORD 'CHANGE_ME_VAULT_MANAGED';
    END IF;
END $$;

-- Forum service
DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_forum') THEN
        CREATE ROLE svc_forum WITH LOGIN PASSWORD 'CHANGE_ME_VAULT_MANAGED';
    END IF;
END $$;

-- Writeup service
DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_writeup') THEN
        CREATE ROLE svc_writeup WITH LOGIN PASSWORD 'CHANGE_ME_VAULT_MANAGED';
    END IF;
END $$;

-- Payment service
DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_payment') THEN
        CREATE ROLE svc_payment WITH LOGIN PASSWORD 'CHANGE_ME_VAULT_MANAGED';
    END IF;
END $$;

-- Bounty service
DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_bounty') THEN
        CREATE ROLE svc_bounty WITH LOGIN PASSWORD 'CHANGE_ME_VAULT_MANAGED';
    END IF;
END $$;

-- Audit writer (used by all services to write audit logs)
DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_audit_writer') THEN
        CREATE ROLE svc_audit_writer WITH LOGIN PASSWORD 'CHANGE_ME_VAULT_MANAGED';
    END IF;
END $$;

-- Analytics read-only role (for ClickHouse syncs, reporting)
DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_analytics_ro') THEN
        CREATE ROLE svc_analytics_ro WITH LOGIN PASSWORD 'CHANGE_ME_VAULT_MANAGED';
    END IF;
END $$;

-- Migration runner (used by CI to apply migrations)
DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'migrator') THEN
        CREATE ROLE migrator WITH LOGIN PASSWORD 'CHANGE_ME_VAULT_MANAGED' CREATEDB;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Schema-level Permissions
-- ---------------------------------------------------------------------------
-- Each service gets full DML on its own schema only.

GRANT USAGE ON SCHEMA auth     TO svc_auth;
GRANT USAGE ON SCHEMA users    TO svc_user;
GRANT USAGE ON SCHEMA content  TO svc_content;
GRANT USAGE ON SCHEMA lab      TO svc_orchestrator;
GRANT USAGE ON SCHEMA scoring  TO svc_scoring;
GRANT USAGE ON SCHEMA ctf      TO svc_ctf;
GRANT USAGE ON SCHEMA forum    TO svc_forum;
GRANT USAGE ON SCHEMA writeup  TO svc_writeup;
GRANT USAGE ON SCHEMA payment  TO svc_payment;
GRANT USAGE ON SCHEMA bounty   TO svc_bounty;
GRANT USAGE ON SCHEMA audit    TO svc_audit_writer;

-- Default privileges so newly created tables inherit grants
ALTER DEFAULT PRIVILEGES IN SCHEMA auth
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_auth;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth
    GRANT USAGE, SELECT ON SEQUENCES TO svc_auth;

ALTER DEFAULT PRIVILEGES IN SCHEMA users
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA users
    GRANT USAGE, SELECT ON SEQUENCES TO svc_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA content
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_content;
ALTER DEFAULT PRIVILEGES IN SCHEMA content
    GRANT USAGE, SELECT ON SEQUENCES TO svc_content;

ALTER DEFAULT PRIVILEGES IN SCHEMA lab
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_orchestrator;
ALTER DEFAULT PRIVILEGES IN SCHEMA lab
    GRANT USAGE, SELECT ON SEQUENCES TO svc_orchestrator;

ALTER DEFAULT PRIVILEGES IN SCHEMA scoring
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_scoring;
ALTER DEFAULT PRIVILEGES IN SCHEMA scoring
    GRANT USAGE, SELECT ON SEQUENCES TO svc_scoring;

ALTER DEFAULT PRIVILEGES IN SCHEMA ctf
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_ctf;
ALTER DEFAULT PRIVILEGES IN SCHEMA ctf
    GRANT USAGE, SELECT ON SEQUENCES TO svc_ctf;

ALTER DEFAULT PRIVILEGES IN SCHEMA forum
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_forum;
ALTER DEFAULT PRIVILEGES IN SCHEMA forum
    GRANT USAGE, SELECT ON SEQUENCES TO svc_forum;

ALTER DEFAULT PRIVILEGES IN SCHEMA writeup
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_writeup;
ALTER DEFAULT PRIVILEGES IN SCHEMA writeup
    GRANT USAGE, SELECT ON SEQUENCES TO svc_writeup;

ALTER DEFAULT PRIVILEGES IN SCHEMA payment
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_payment;
ALTER DEFAULT PRIVILEGES IN SCHEMA payment
    GRANT USAGE, SELECT ON SEQUENCES TO svc_payment;

ALTER DEFAULT PRIVILEGES IN SCHEMA bounty
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_bounty;
ALTER DEFAULT PRIVILEGES IN SCHEMA bounty
    GRANT USAGE, SELECT ON SEQUENCES TO svc_bounty;

-- Audit: all services can INSERT, no one can UPDATE/DELETE (immutable)
ALTER DEFAULT PRIVILEGES IN SCHEMA audit
    GRANT INSERT, SELECT ON TABLES TO svc_audit_writer;

-- Cross-service grants (specific exceptions)
GRANT USAGE ON SCHEMA audit TO svc_auth, svc_user, svc_content, svc_orchestrator,
                                svc_scoring, svc_ctf, svc_forum, svc_writeup,
                                svc_payment, svc_bounty;
ALTER DEFAULT PRIVILEGES IN SCHEMA audit
    GRANT INSERT ON TABLES TO svc_auth, svc_user, svc_content, svc_orchestrator,
                              svc_scoring, svc_ctf, svc_forum, svc_writeup,
                              svc_payment, svc_bounty;

-- Analytics RO has read on everything
GRANT USAGE ON SCHEMA auth, users, content, lab, scoring, ctf, forum, writeup,
                      payment, bounty, audit TO svc_analytics_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth, users, content, lab, scoring, ctf,
                                    forum, writeup, payment, bounty, audit
    GRANT SELECT ON TABLES TO svc_analytics_ro;

-- Migrator has DDL on all schemas
GRANT ALL ON SCHEMA auth, users, content, lab, scoring, ctf, forum, writeup,
                    payment, bounty, audit TO migrator;

-- ---------------------------------------------------------------------------
-- Utility Functions (used across schemas)
-- ---------------------------------------------------------------------------

-- Trigger to auto-update updated_at on row modification
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- UUID v7 generation (time-ordered, better for B-tree indexes)
-- Useful for high-write tables like submissions, audit log
CREATE OR REPLACE FUNCTION uuid_generate_v7()
RETURNS UUID AS $$
DECLARE
    unix_ts_ms BIGINT;
    uuid_bytes BYTEA;
BEGIN
    unix_ts_ms := (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT;
    uuid_bytes := gen_random_bytes(10);

    -- Set version (7) in byte 6
    uuid_bytes := SET_BYTE(uuid_bytes, 0, (GET_BYTE(uuid_bytes, 0) & 15) | 112);
    -- Set variant (RFC 4122) in byte 8
    uuid_bytes := SET_BYTE(uuid_bytes, 2, (GET_BYTE(uuid_bytes, 2) & 63) | 128);

    RETURN ENCODE(
        SET_BYTE(SET_BYTE(SET_BYTE(SET_BYTE(SET_BYTE(SET_BYTE(
            '\x000000000000'::BYTEA,   -- 6 timestamp bytes; +10 random = 16
            0, ((unix_ts_ms >> 40) & 255)::INT),
            1, ((unix_ts_ms >> 32) & 255)::INT),
            2, ((unix_ts_ms >> 24) & 255)::INT),
            3, ((unix_ts_ms >> 16) & 255)::INT),
            4, ((unix_ts_ms >> 8) & 255)::INT),
            5, (unix_ts_ms & 255)::INT) ||
        uuid_bytes,
        'hex'
    )::UUID;
END;
$$ LANGUAGE plpgsql VOLATILE;

-- HMAC-SHA256 hex (used for flag hashing)
CREATE OR REPLACE FUNCTION hmac_sha256_hex(message TEXT, key TEXT)
RETURNS TEXT AS $$
    SELECT ENCODE(HMAC(message::BYTEA, key::BYTEA, 'sha256'), 'hex');
$$ LANGUAGE SQL IMMUTABLE STRICT;

-- ---------------------------------------------------------------------------
-- Search path defaults
-- ---------------------------------------------------------------------------
ALTER ROLE svc_auth         SET search_path = auth, public;
ALTER ROLE svc_user         SET search_path = users, public;
ALTER ROLE svc_content      SET search_path = content, public;
ALTER ROLE svc_orchestrator SET search_path = lab, public;
ALTER ROLE svc_scoring      SET search_path = scoring, public;
ALTER ROLE svc_ctf          SET search_path = ctf, public;
ALTER ROLE svc_forum        SET search_path = forum, public;
ALTER ROLE svc_writeup      SET search_path = writeup, public;
ALTER ROLE svc_payment      SET search_path = payment, public;
ALTER ROLE svc_bounty       SET search_path = bounty, public;
