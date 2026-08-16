-- Writeup schema rollback
DROP TABLE IF EXISTS writeup.comments CASCADE;
DROP TABLE IF EXISTS writeup.bookmarks CASCADE;
DROP TABLE IF EXISTS writeup.votes CASCADE;
DROP TABLE IF EXISTS writeup.writeups CASCADE;
