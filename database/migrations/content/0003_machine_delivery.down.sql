ALTER TABLE content.machines DROP CONSTRAINT IF EXISTS chk_machine_delivery_fields;
ALTER TABLE content.machines DROP CONSTRAINT IF EXISTS chk_machine_delivery;

-- Rows created as static_host or download have no image_ref, so restoring the
-- NOT NULL would fail on them. Left nullable deliberately: the alternative is
-- inventing an image reference for a machine that never had one.
ALTER TABLE content.machines
    DROP COLUMN IF EXISTS download_format,
    DROP COLUMN IF EXISTS download_size_bytes,
    DROP COLUMN IF EXISTS download_sha256,
    DROP COLUMN IF EXISTS download_url,
    DROP COLUMN IF EXISTS static_host,
    DROP COLUMN IF EXISTS delivery;
