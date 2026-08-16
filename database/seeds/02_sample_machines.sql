-- =============================================================================
-- Seed Data — Sample Machines
-- =============================================================================
-- DEV/STAGING ONLY. Creates predictable machine entries for testing.
-- =============================================================================

-- Fixed UUIDs for reference
-- blue          : 10000000-0000-0000-0000-000000000001
-- legacy        : 10000000-0000-0000-0000-000000000002
-- shocker       : 10000000-0000-0000-0000-000000000003
-- forest        : 10000000-0000-0000-0000-000000000004
-- sherlock      : 10000000-0000-0000-0000-000000000005

WITH cat AS (
    SELECT id FROM content.categories WHERE slug = 'ad' LIMIT 1
)
INSERT INTO content.machines (
    id, slug, name, description, os, difficulty, category_id, backend,
    image_ref, image_version, base_user_points, base_root_points, base_challenge_points,
    status, released_at, has_user_flag, has_root_flag
) VALUES
    ('10000000-0000-0000-0000-000000000001'::uuid,
     'blue', 'Blue', 'Easy Windows machine featuring EternalBlue (MS17-010)',
     'windows', 'easy', NULL, 'vm',
     'harbor.offensiveconditions.org/machines/blue', 'v1.0',
     10, 20, 30, 'active', NOW() - INTERVAL '30 days', TRUE, TRUE),

    ('10000000-0000-0000-0000-000000000002'::uuid,
     'legacy', 'Legacy', 'Very easy Windows XP machine vulnerable to MS08-067',
     'windows', 'very_easy', NULL, 'vm',
     'harbor.offensiveconditions.org/machines/legacy', 'v1.0',
     10, 20, 30, 'active', NOW() - INTERVAL '60 days', TRUE, TRUE),

    ('10000000-0000-0000-0000-000000000003'::uuid,
     'shocker', 'Shocker', 'Linux machine featuring Shellshock vulnerability',
     'linux', 'easy', NULL, 'container',
     'harbor.offensiveconditions.org/machines/shocker', 'v1.0',
     10, 20, 30, 'active', NOW() - INTERVAL '20 days', TRUE, TRUE),

    ('10000000-0000-0000-0000-000000000004'::uuid,
     'forest', 'Forest', 'Active Directory machine with AS-REP roasting',
     'windows', 'easy', (SELECT id FROM cat), 'vm',
     'harbor.offensiveconditions.org/machines/forest', 'v1.0',
     10, 20, 30, 'active', NOW() - INTERVAL '15 days', TRUE, TRUE),

    ('10000000-0000-0000-0000-000000000005'::uuid,
     'sherlock', 'Sherlock', 'Medium Linux machine with custom web app and pivot',
     'linux', 'medium', NULL, 'container',
     'harbor.offensiveconditions.org/machines/sherlock', 'v1.0',
     20, 30, 50, 'active', NOW() - INTERVAL '10 days', TRUE, TRUE)
ON CONFLICT (id) DO NOTHING;

-- Tags
INSERT INTO content.tags (slug, name) VALUES
    ('beginner', 'Beginner'),
    ('cve', 'CVE-based'),
    ('ad', 'Active Directory'),
    ('web', 'Web'),
    ('shellshock', 'Shellshock'),
    ('eternalblue', 'EternalBlue'),
    ('as-rep-roasting', 'AS-REP Roasting'),
    ('lateral-movement', 'Lateral Movement'),
    ('kerberos', 'Kerberos'),
    ('smb', 'SMB')
ON CONFLICT (slug) DO NOTHING;

-- Link tags to machines
INSERT INTO content.machine_tags (machine_id, tag_id)
SELECT '10000000-0000-0000-0000-000000000001'::uuid, id FROM content.tags WHERE slug IN ('beginner','cve','eternalblue','smb')
ON CONFLICT DO NOTHING;

INSERT INTO content.machine_tags (machine_id, tag_id)
SELECT '10000000-0000-0000-0000-000000000003'::uuid, id FROM content.tags WHERE slug IN ('beginner','cve','shellshock','web')
ON CONFLICT DO NOTHING;

INSERT INTO content.machine_tags (machine_id, tag_id)
SELECT '10000000-0000-0000-0000-000000000004'::uuid, id FROM content.tags WHERE slug IN ('ad','kerberos','as-rep-roasting')
ON CONFLICT DO NOTHING;

-- Update tag usage counts
UPDATE content.tags t SET usage_count = (
    SELECT COUNT(*) FROM content.machine_tags mt WHERE mt.tag_id = t.id
);

-- Sample challenges
INSERT INTO content.challenges (
    id, slug, name, description, category_id, difficulty, points,
    requires_instance, static_flag_hash, image_ref, status, released_at
) VALUES
    ('20000000-0000-0000-0000-000000000001'::uuid,
     'simple-xor', 'Simple XOR', 'Decrypt the message using XOR',
     (SELECT id FROM content.categories WHERE slug = 'crypto'),
     'very_easy', 10, FALSE,
     encode(digest('OFFCON{x0r_15_n0t_3ncrypt10n}', 'sha256'), 'hex'),
     NULL,
     'active', NOW() - INTERVAL '7 days'),

    ('20000000-0000-0000-0000-000000000002'::uuid,
     'sqli-101', 'SQL Injection 101', 'Bypass the login form',
     (SELECT id FROM content.categories WHERE slug = 'web'),
     'easy', 25, TRUE,
     NULL,
     'harbor.offensiveconditions.org/challenges/sqli-101:v1',
     'active', NOW() - INTERVAL '5 days'),

    ('20000000-0000-0000-0000-000000000003'::uuid,
     'baby-rop', 'Baby ROP', 'Build a small ROP chain to spawn a shell',
     (SELECT id FROM content.categories WHERE slug = 'pwn'),
     'medium', 75, TRUE,
     NULL,
     'harbor.offensiveconditions.org/challenges/baby-rop:v1',
     'active', NOW() - INTERVAL '3 days')
ON CONFLICT (id) DO NOTHING;

-- Sample learning path
INSERT INTO content.learning_paths (
    id, slug, name, description, difficulty, estimated_hours, status, released_at, completion_points
) VALUES
    ('30000000-0000-0000-0000-000000000001'::uuid,
     'penetration-tester', 'Penetration Tester',
     'Complete guide to becoming a penetration tester',
     'beginner', 80, 'active', NOW() - INTERVAL '60 days', 500)
ON CONFLICT (id) DO NOTHING;

INSERT INTO content.path_modules (
    path_id, sequence, title, content_markdown, estimated_minutes, completion_points
) VALUES
    ('30000000-0000-0000-0000-000000000001'::uuid, 1,
     'Introduction to Penetration Testing',
     '# Introduction\n\nWelcome to the Penetration Tester path...',
     30, 10),
    ('30000000-0000-0000-0000-000000000001'::uuid, 2,
     'Reconnaissance Fundamentals',
     '# Reconnaissance\n\nPassive and active recon techniques...',
     60, 20),
    ('30000000-0000-0000-0000-000000000001'::uuid, 3,
     'Network Enumeration',
     '# Network Enumeration\n\nPort scanning, service discovery...',
     90, 30)
ON CONFLICT DO NOTHING;
