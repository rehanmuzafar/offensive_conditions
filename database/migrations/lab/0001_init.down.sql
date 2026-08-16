-- Lab schema rollback
DROP TABLE IF EXISTS lab.image_cache CASCADE;
DROP TABLE IF EXISTS lab.spawn_queue CASCADE;
DROP TABLE IF EXISTS lab.user_quotas CASCADE;
DROP TABLE IF EXISTS lab.instance_events_2026_07 CASCADE;
DROP TABLE IF EXISTS lab.instance_events_2026_06 CASCADE;
DROP TABLE IF EXISTS lab.instance_events_2026_05 CASCADE;
DROP TABLE IF EXISTS lab.instance_events CASCADE;
DROP TABLE IF EXISTS lab.pro_lab_instance_members CASCADE;
DROP TABLE IF EXISTS lab.pro_lab_sessions CASCADE;
DROP TABLE IF EXISTS lab.instances CASCADE;
DROP TABLE IF EXISTS lab.network_allocations CASCADE;
DROP TABLE IF EXISTS lab.nodes CASCADE;
