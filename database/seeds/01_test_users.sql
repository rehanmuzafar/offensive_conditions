-- =============================================================================
-- Seed Data — Test Users
-- =============================================================================
-- DEV/STAGING ONLY. Creates predictable test users.
-- All passwords are 'Test1234!' hashed via Argon2id (computed offline).
-- =============================================================================

-- Test user IDs (fixed UUIDs for reference in other seed files)
-- admin     : 00000000-0000-0000-0000-000000000001
-- alice     : 00000000-0000-0000-0000-000000000002
-- bob       : 00000000-0000-0000-0000-000000000003
-- carol     : 00000000-0000-0000-0000-000000000004
-- pakhacker : 00000000-0000-0000-0000-000000000005

-- Argon2id hash of "Test1234!" with parameters: t=2, m=64MB, p=1
-- This specific hash is for development only.
-- Real users will have hashes generated server-side.

INSERT INTO auth.users (
    id, email, username, password_hash, email_verified, status, role
) VALUES
    ('00000000-0000-0000-0000-000000000001'::uuid,
     'admin@offensiveconditions.org', 'admin',
     '$argon2id$v=19$m=65536,t=2,p=1$c2VlZHNhbHRzZWVkc2FsdA$DEV_PLACEHOLDER_REPLACE_AT_BOOTSTRAP',
     TRUE, 'active', 'admin'),
    ('00000000-0000-0000-0000-000000000002'::uuid,
     'alice@offensiveconditions.org', 'alice',
     '$argon2id$v=19$m=65536,t=2,p=1$c2VlZHNhbHRzZWVkc2FsdA$DEV_PLACEHOLDER_REPLACE_AT_BOOTSTRAP',
     TRUE, 'active', 'user'),
    ('00000000-0000-0000-0000-000000000003'::uuid,
     'bob@offensiveconditions.org', 'bob',
     '$argon2id$v=19$m=65536,t=2,p=1$c2VlZHNhbHRzZWVkc2FsdA$DEV_PLACEHOLDER_REPLACE_AT_BOOTSTRAP',
     TRUE, 'active', 'user'),
    ('00000000-0000-0000-0000-000000000004'::uuid,
     'carol@offensiveconditions.org', 'carol',
     '$argon2id$v=19$m=65536,t=2,p=1$c2VlZHNhbHRzZWVkc2FsdA$DEV_PLACEHOLDER_REPLACE_AT_BOOTSTRAP',
     TRUE, 'active', 'content_creator'),
    ('00000000-0000-0000-0000-000000000005'::uuid,
     'pakhacker@offensiveconditions.org', 'pakhacker',
     '$argon2id$v=19$m=65536,t=2,p=1$c2VlZHNhbHRzZWVkc2FsdA$DEV_PLACEHOLDER_REPLACE_AT_BOOTSTRAP',
     TRUE, 'active', 'user')
ON CONFLICT (id) DO NOTHING;

-- Profiles
INSERT INTO users.profiles (
    user_id, display_name, bio, country_code, language
) VALUES
    ('00000000-0000-0000-0000-000000000001'::uuid,
     'Platform Admin', 'System administrator', 'PK', 'en'),
    ('00000000-0000-0000-0000-000000000002'::uuid,
     'Alice', 'Just a curious hacker', 'US', 'en'),
    ('00000000-0000-0000-0000-000000000003'::uuid,
     'Bob the Builder', 'Building secure systems by breaking insecure ones', 'GB', 'en'),
    ('00000000-0000-0000-0000-000000000004'::uuid,
     'Carol', 'Content creator and CTF designer', 'DE', 'en'),
    ('00000000-0000-0000-0000-000000000005'::uuid,
     'Pakistani Hacker', 'PK red team enthusiast', 'PK', 'ur')
ON CONFLICT (user_id) DO NOTHING;

-- Default preferences
INSERT INTO users.preferences (user_id) VALUES
    ('00000000-0000-0000-0000-000000000001'::uuid),
    ('00000000-0000-0000-0000-000000000002'::uuid),
    ('00000000-0000-0000-0000-000000000003'::uuid),
    ('00000000-0000-0000-0000-000000000004'::uuid),
    ('00000000-0000-0000-0000-000000000005'::uuid)
ON CONFLICT (user_id) DO NOTHING;

-- Subscriptions (varied tiers for testing)
INSERT INTO users.subscriptions (
    user_id, tier, status, max_concurrent_instances, max_daily_spawns,
    pro_labs_access, pwnbox_access, advanced_analytics
) VALUES
    ('00000000-0000-0000-0000-000000000001'::uuid, 'enterprise', 'active', 50, 9999, TRUE, TRUE, TRUE),
    ('00000000-0000-0000-0000-000000000002'::uuid, 'free',       'active', 2,  10,   FALSE, FALSE, FALSE),
    ('00000000-0000-0000-0000-000000000003'::uuid, 'vip',        'active', 5,  100,  FALSE, TRUE,  FALSE),
    ('00000000-0000-0000-0000-000000000004'::uuid, 'vip_plus',   'active', 10, 999,  TRUE, TRUE,  TRUE),
    ('00000000-0000-0000-0000-000000000005'::uuid, 'free',       'active', 2,  10,   FALSE, FALSE, FALSE)
ON CONFLICT (user_id) DO NOTHING;

-- Activity records
INSERT INTO users.activity (user_id, last_seen_at, online_status, total_login_count) VALUES
    ('00000000-0000-0000-0000-000000000001'::uuid, NOW(), 'online', 100),
    ('00000000-0000-0000-0000-000000000002'::uuid, NOW() - INTERVAL '1 hour', 'offline', 42),
    ('00000000-0000-0000-0000-000000000003'::uuid, NOW() - INTERVAL '30 minutes', 'online', 78),
    ('00000000-0000-0000-0000-000000000004'::uuid, NOW() - INTERVAL '2 days', 'offline', 15),
    ('00000000-0000-0000-0000-000000000005'::uuid, NOW() - INTERVAL '5 minutes', 'online', 5)
ON CONFLICT (user_id) DO NOTHING;

-- Initial scores (zero)
INSERT INTO scoring.user_scores (user_id, total_points, country_code, rank_tier) VALUES
    ('00000000-0000-0000-0000-000000000001'::uuid, 0, 'PK', 'noob'),
    ('00000000-0000-0000-0000-000000000002'::uuid, 0, 'US', 'noob'),
    ('00000000-0000-0000-0000-000000000003'::uuid, 0, 'GB', 'noob'),
    ('00000000-0000-0000-0000-000000000004'::uuid, 0, 'DE', 'noob'),
    ('00000000-0000-0000-0000-000000000005'::uuid, 0, 'PK', 'noob')
ON CONFLICT (user_id) DO NOTHING;

-- Empty quotas
INSERT INTO lab.user_quotas (user_id, max_concurrent, max_daily) VALUES
    ('00000000-0000-0000-0000-000000000001'::uuid, 50, 9999),
    ('00000000-0000-0000-0000-000000000002'::uuid, 2, 10),
    ('00000000-0000-0000-0000-000000000003'::uuid, 5, 100),
    ('00000000-0000-0000-0000-000000000004'::uuid, 10, 999),
    ('00000000-0000-0000-0000-000000000005'::uuid, 2, 10)
ON CONFLICT (user_id) DO NOTHING;
