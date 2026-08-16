DROP TRIGGER IF EXISTS trg_create_profile_for_new_user ON auth.users;
DROP FUNCTION IF EXISTS users.create_profile_for_new_user();
