-- =============================================================================
-- Seed Data — Compute Nodes & Achievements
-- =============================================================================

-- Sample lab compute nodes (for local dev — actual nodes registered by orchestrator on boot)
INSERT INTO lab.nodes (
    id, type, region, cpu_total_milli, mem_total_mb, disk_total_gb,
    supports_gvisor, status, labels
) VALUES
    ('k8s-lab-eu-1', 'k8s', 'eu-central', 16000, 32768, 500, TRUE, 'ready',
     '{"workload":"container","backend":"k8s","tier":"general"}'::jsonb),
    ('k8s-lab-eu-2', 'k8s', 'eu-central', 16000, 32768, 500, TRUE, 'ready',
     '{"workload":"container","backend":"k8s","tier":"general"}'::jsonb),
    ('proxmox-eu-1', 'proxmox', 'eu-central', 32000, 65536, 2000, FALSE, 'ready',
     '{"workload":"vm","backend":"proxmox","supports_windows":"true"}'::jsonb),
    ('k8s-lab-us-1', 'k8s', 'us-east', 16000, 32768, 500, TRUE, 'ready',
     '{"workload":"container","backend":"k8s","tier":"general"}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- Update extra columns
UPDATE lab.nodes SET supports_windows = TRUE WHERE id = 'proxmox-eu-1';

-- Achievements catalog
INSERT INTO scoring.achievements (
    code, name, description, category, rarity, points_awarded,
    trigger_type, trigger_config, is_secret, sort_order
) VALUES
    -- Progression
    ('first_login', 'Welcome Aboard', 'Sign in for the first time', 'progression', 'common', 5,
     'count', '{"event":"login","count":1}'::jsonb, FALSE, 1),
    ('first_machine_owned', 'First Blood (Personal)', 'Own your first machine', 'progression', 'common', 25,
     'count', '{"event":"machine_owned","count":1}'::jsonb, FALSE, 2),
    ('first_challenge_solved', 'Challenger', 'Solve your first challenge', 'progression', 'common', 15,
     'count', '{"event":"challenge_solved","count":1}'::jsonb, FALSE, 3),
    ('ten_machines', 'Getting Serious', 'Own 10 machines', 'progression', 'uncommon', 100,
     'count', '{"event":"machine_owned","count":10}'::jsonb, FALSE, 4),
    ('fifty_machines', 'Veteran', 'Own 50 machines', 'progression', 'rare', 500,
     'count', '{"event":"machine_owned","count":50}'::jsonb, FALSE, 5),
    ('hundred_machines', 'Centurion', 'Own 100 machines', 'progression', 'epic', 1500,
     'count', '{"event":"machine_owned","count":100}'::jsonb, FALSE, 6),

    -- Mastery
    ('first_root', 'Root Access Granted', 'Obtain your first root flag', 'mastery', 'common', 30,
     'count', '{"event":"root_owned","count":1}'::jsonb, FALSE, 10),
    ('insane_owned', 'Insane in the Membrane', 'Own an Insane difficulty machine', 'mastery', 'epic', 1000,
     'specific', '{"machine_difficulty":"insane"}'::jsonb, FALSE, 11),
    ('all_categories', 'Polymath', 'Own at least one machine from each category', 'mastery', 'epic', 750,
     'specific', '{"requirement":"all_categories"}'::jsonb, FALSE, 12),

    -- Streaks
    ('seven_day_streak', 'Week Warrior', 'Solve something 7 days in a row', 'mastery', 'uncommon', 200,
     'streak', '{"days":7}'::jsonb, FALSE, 20),
    ('thirty_day_streak', 'Dedication', 'Solve something 30 days in a row', 'mastery', 'rare', 1000,
     'streak', '{"days":30}'::jsonb, FALSE, 21),
    ('hundred_day_streak', 'Obsessed', 'Solve something 100 days in a row', 'mastery', 'legendary', 5000,
     'streak', '{"days":100}'::jsonb, FALSE, 22),

    -- First bloods
    ('first_blood_collector', 'Vampire', 'Obtain 10 first bloods', 'mastery', 'rare', 1000,
     'count', '{"event":"first_blood","count":10}'::jsonb, FALSE, 30),
    ('first_blood_legend', 'Bathory', 'Obtain 100 first bloods', 'mastery', 'legendary', 10000,
     'count', '{"event":"first_blood","count":100}'::jsonb, FALSE, 31),

    -- Community
    ('first_writeup', 'Author', 'Publish your first writeup', 'community', 'common', 50,
     'count', '{"event":"writeup_approved","count":1}'::jsonb, FALSE, 40),
    ('helpful_member', 'Helpful Hand', 'Receive 100 upvotes on forum posts', 'community', 'uncommon', 200,
     'threshold', '{"metric":"forum_upvotes","value":100}'::jsonb, FALSE, 41),
    ('team_player', 'Team Player', 'Join a team', 'community', 'common', 10,
     'count', '{"event":"team_joined","count":1}'::jsonb, FALSE, 42),

    -- Special / Secret
    ('night_owl', 'Night Owl', 'Solve a challenge between 2am and 5am', 'special', 'uncommon', 50,
     'specific', '{"time_range":"02:00-05:00"}'::jsonb, TRUE, 50),
    ('speed_demon', 'Speed Demon', 'Own a machine in under 15 minutes', 'special', 'rare', 300,
     'specific', '{"max_solve_minutes":15}'::jsonb, TRUE, 51),
    ('comeback_kid', 'Comeback Kid', 'Return after 30+ days inactive and solve something', 'special', 'uncommon', 100,
     'specific', '{"inactivity_days":30}'::jsonb, TRUE, 52)
ON CONFLICT (code) DO NOTHING;
