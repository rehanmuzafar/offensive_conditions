ALTER TABLE lab.instances
    DROP COLUMN IF EXISTS machine_slug, DROP COLUMN IF EXISTS state,
    DROP COLUMN IF EXISTS backend_ref, DROP COLUMN IF EXISTS backend_node,
    DROP COLUMN IF EXISTS ip_address, DROP COLUMN IF EXISTS vlan_tag,
    DROP COLUMN IF EXISTS flag_user_hash, DROP COLUMN IF EXISTS flag_root_hash,
    DROP COLUMN IF EXISTS started_at, DROP COLUMN IF EXISTS extensions_used,
    DROP COLUMN IF EXISTS last_healthy_at, DROP COLUMN IF EXISTS health_status,
    DROP COLUMN IF EXISTS failure_reason, DROP COLUMN IF EXISTS request_id;
