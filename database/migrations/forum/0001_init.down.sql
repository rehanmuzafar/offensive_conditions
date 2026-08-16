-- Forum schema rollback
DROP TABLE IF EXISTS forum.reports CASCADE;
DROP TABLE IF EXISTS forum.user_reputation CASCADE;
DROP TABLE IF EXISTS forum.thread_subscriptions CASCADE;
DROP TABLE IF EXISTS forum.post_votes CASCADE;
DROP TABLE IF EXISTS forum.posts CASCADE;
DROP TABLE IF EXISTS forum.threads CASCADE;
DROP TABLE IF EXISTS forum.categories CASCADE;
