ALTER TABLE users.profiles DROP CONSTRAINT IF EXISTS chk_profile_account_type;
ALTER TABLE users.profiles
    DROP COLUMN IF EXISTS account_type,
    DROP COLUMN IF EXISTS company_name,
    DROP COLUMN IF EXISTS company_website;
