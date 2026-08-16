-- =============================================================================
-- Lab Schema — Initial Migration
-- =============================================================================
-- Handles: lab instances, compute nodes, network allocation, flag storage
-- This is the orchestrator's core state.
-- =============================================================================

SET search_path = lab, public;

-- ---------------------------------------------------------------------------
-- Compute Nodes (K8s workers + Proxmox hosts)
-- ---------------------------------------------------------------------------
CREATE TABLE lab.nodes (
    id              TEXT PRIMARY KEY,                      -- Hostname or K8s node name
    type            TEXT NOT NULL,                         -- k8s|proxmox
    region          TEXT NOT NULL,                         -- us-east|eu-central|asia-south
    -- Resources (total and currently used)
    cpu_total_milli INT NOT NULL,
    cpu_used_milli  INT NOT NULL DEFAULT 0,
    mem_total_mb    INT NOT NULL,
    mem_used_mb     INT NOT NULL DEFAULT 0,
    disk_total_gb   INT NOT NULL,
    disk_used_gb    INT NOT NULL DEFAULT 0,
    -- Capabilities
    supports_kvm    BOOLEAN NOT NULL DEFAULT FALSE,
    supports_gvisor BOOLEAN NOT NULL DEFAULT TRUE,
    supports_windows BOOLEAN NOT NULL DEFAULT FALSE,
    network_mode    TEXT NOT NULL DEFAULT 'calico',
    -- Health
    status          TEXT NOT NULL DEFAULT 'ready',         -- ready|draining|cordoned|down|maintenance
    last_heartbeat  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Metadata
    labels          JSONB DEFAULT '{}'::JSONB,             -- K8s-style labels
    metadata        JSONB DEFAULT '{}'::JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_node_type CHECK (type IN ('k8s','proxmox')),
    CONSTRAINT chk_node_status CHECK (status IN ('ready','draining','cordoned','down','maintenance'))
);

CREATE INDEX idx_nodes_status ON lab.nodes (status) WHERE status = 'ready';
CREATE INDEX idx_nodes_region ON lab.nodes (region) WHERE status = 'ready';
CREATE INDEX idx_nodes_heartbeat ON lab.nodes (last_heartbeat);

CREATE TRIGGER trg_nodes_updated_at
    BEFORE UPDATE ON lab.nodes
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Network Allocations (per-user VLANs + subnets)
-- ---------------------------------------------------------------------------
CREATE TABLE lab.network_allocations (
    user_id         UUID PRIMARY KEY,                      -- One persistent network per user
    vlan_id         INT NOT NULL UNIQUE,                   -- 1000-4000 range
    subnet          CIDR NOT NULL UNIQUE,                  -- e.g. 10.10.5.0/24
    gateway_ip      INET NOT NULL,
    -- WireGuard mapping
    region          TEXT NOT NULL,
    -- Lifecycle
    allocated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_active_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Stats
    total_instances_spawned INT NOT NULL DEFAULT 0,

    CONSTRAINT chk_vlan_range CHECK (vlan_id BETWEEN 1000 AND 4000),
    CONSTRAINT chk_alloc_region CHECK (region IN ('us-east','eu-central','asia-south','pak-local'))
);

CREATE INDEX idx_network_alloc_region ON lab.network_allocations (region);

COMMENT ON TABLE lab.network_allocations IS 'Persistent per-user network. Reused across instances to maintain VPN tunnel stability';

-- ---------------------------------------------------------------------------
-- Lab Instances (the core lifecycle table)
-- ---------------------------------------------------------------------------
CREATE TABLE lab.instances (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL,
    -- What's running
    content_type    TEXT NOT NULL,                         -- machine|challenge|dojo_level|pro_lab
    machine_id      UUID,
    challenge_id    UUID,
    dojo_level_id   UUID,
    pro_lab_id      UUID,
    -- Where it's running
    backend         TEXT NOT NULL,                         -- container|vm
    node_id         TEXT REFERENCES lab.nodes(id),
    pod_name        TEXT,                                  -- K8s pod name (if container)
    namespace       TEXT,                                  -- K8s namespace (if container)
    vm_id           TEXT,                                  -- Proxmox VMID (if VM)
    -- Network
    vlan_id         INT,
    subnet          CIDR,
    instance_ip     INET,                                  -- Primary IP user connects to
    extra_ips       INET[] DEFAULT '{}',                   -- For multi-NIC machines
    -- Lifecycle
    status          TEXT NOT NULL DEFAULT 'requested',
    spawned_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ready_at        TIMESTAMPTZ,                           -- When instance became reachable
    expires_at      TIMESTAMPTZ NOT NULL,
    terminated_at   TIMESTAMPTZ,
    termination_reason TEXT,                               -- ttl|user|admin|node_failure|policy
    -- Image
    image_ref       TEXT NOT NULL,
    image_version   TEXT,
    -- Flag storage (per-instance generated)
    flags           JSONB DEFAULT '{}'::JSONB,             -- {user_flag_hash, root_flag_hash, ...}
    flag_salt       TEXT NOT NULL,                         -- Used in HMAC for flag generation
    -- Resource allocation snapshot
    cpu_millicores  INT NOT NULL,
    memory_mb       INT NOT NULL,
    disk_gb         INT NOT NULL DEFAULT 10,
    -- Metadata
    metadata        JSONB DEFAULT '{}'::JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_instance_content_type CHECK (content_type IN ('machine','challenge','dojo_level','pro_lab')),
    CONSTRAINT chk_instance_backend CHECK (backend IN ('container','vm')),
    CONSTRAINT chk_instance_status CHECK (status IN (
        'requested',     -- API received request
        'queued',        -- Waiting for capacity
        'scheduling',    -- Picking a node
        'spawning',      -- Creating pod/VM
        'starting',      -- Pod/VM exists, awaiting readiness
        'running',       -- Reachable, in use
        'extending',     -- TTL being extended
        'terminating',   -- Shutdown in progress
        'terminated',    -- Successfully cleaned up
        'failed'         -- Failed at any stage
    )),
    CONSTRAINT chk_instance_content CHECK (
        (content_type = 'machine' AND machine_id IS NOT NULL) OR
        (content_type = 'challenge' AND challenge_id IS NOT NULL) OR
        (content_type = 'dojo_level' AND dojo_level_id IS NOT NULL) OR
        (content_type = 'pro_lab' AND pro_lab_id IS NOT NULL)
    )
);

-- Performance indexes
CREATE INDEX idx_instances_user_status ON lab.instances (user_id, status)
    WHERE status IN ('running','spawning','starting','scheduling','queued','requested');
CREATE INDEX idx_instances_status ON lab.instances (status);
CREATE INDEX idx_instances_expires ON lab.instances (expires_at)
    WHERE status IN ('running','starting');
CREATE INDEX idx_instances_node ON lab.instances (node_id) WHERE status IN ('running','starting');
CREATE INDEX idx_instances_machine ON lab.instances (machine_id);
CREATE INDEX idx_instances_user_machine_status ON lab.instances (user_id, machine_id, status);
CREATE INDEX idx_instances_spawned_at ON lab.instances (spawned_at DESC);

CREATE TRIGGER trg_instances_updated_at
    BEFORE UPDATE ON lab.instances
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Pro Lab Instances (group of related instances for multi-machine labs)
-- ---------------------------------------------------------------------------
CREATE TABLE lab.pro_lab_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL,
    pro_lab_id      UUID NOT NULL,
    -- Network for the entire Pro Lab session (different from user's persistent VLAN)
    vlan_id         INT NOT NULL,
    subnet          CIDR NOT NULL,
    -- Lifecycle
    status          TEXT NOT NULL DEFAULT 'spawning',      -- spawning|running|terminating|terminated|failed
    spawned_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL,
    terminated_at   TIMESTAMPTZ,
    -- Progress tracking
    flags_obtained  TEXT[] DEFAULT '{}',                   -- IDs of obtained flags
    metadata        JSONB DEFAULT '{}'::JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_prolab_session_status CHECK (status IN ('spawning','running','terminating','terminated','failed'))
);

CREATE INDEX idx_prolab_sessions_user ON lab.pro_lab_sessions (user_id, status);
CREATE INDEX idx_prolab_sessions_expires ON lab.pro_lab_sessions (expires_at) WHERE status = 'running';

-- ---------------------------------------------------------------------------
-- Pro Lab Instance Members (links pro lab session to individual machine instances)
-- ---------------------------------------------------------------------------
CREATE TABLE lab.pro_lab_instance_members (
    session_id      UUID NOT NULL REFERENCES lab.pro_lab_sessions(id) ON DELETE CASCADE,
    instance_id     UUID NOT NULL REFERENCES lab.instances(id) ON DELETE CASCADE,
    machine_role    TEXT,                                  -- Mirror of pro_lab_machines.role
    PRIMARY KEY (session_id, instance_id)
);

CREATE INDEX idx_prolab_members_instance ON lab.pro_lab_instance_members (instance_id);

-- ---------------------------------------------------------------------------
-- Instance Events (state transition log per instance)
-- ---------------------------------------------------------------------------
CREATE TABLE lab.instance_events (
    id              UUID NOT NULL DEFAULT public.uuid_generate_v7(),
    instance_id     UUID NOT NULL,                         -- No FK for performance, instances may be deleted
    event_type      TEXT NOT NULL,                         -- spawn_requested|node_assigned|pod_created|ready|...
    previous_status TEXT,
    new_status      TEXT,
    message         TEXT,
    metadata        JSONB DEFAULT '{}'::JSONB,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE lab.instance_events_2026_05 PARTITION OF lab.instance_events
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE lab.instance_events_2026_06 PARTITION OF lab.instance_events
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE lab.instance_events_2026_07 PARTITION OF lab.instance_events
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

CREATE INDEX idx_instance_events_instance ON lab.instance_events (instance_id, occurred_at DESC);

-- ---------------------------------------------------------------------------
-- Instance Quota Tracking (per-user)
-- ---------------------------------------------------------------------------
CREATE TABLE lab.user_quotas (
    user_id         UUID PRIMARY KEY,
    -- Current state
    active_count    INT NOT NULL DEFAULT 0,
    -- Daily counters (reset by job at UTC midnight)
    daily_spawn_count INT NOT NULL DEFAULT 0,
    daily_reset_at  DATE NOT NULL DEFAULT CURRENT_DATE,
    -- Limits (cached from subscription)
    max_concurrent  INT NOT NULL DEFAULT 2,
    max_daily       INT NOT NULL DEFAULT 10,
    -- Total counters (lifetime)
    total_instances_spawned BIGINT NOT NULL DEFAULT 0,
    total_minutes_consumed  BIGINT NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_quotas_daily_reset ON lab.user_quotas (daily_reset_at);

CREATE TRIGGER trg_quotas_updated_at
    BEFORE UPDATE ON lab.user_quotas
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Spawn Queue (when capacity exhausted)
-- ---------------------------------------------------------------------------
CREATE TABLE lab.spawn_queue (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL,
    content_type    TEXT NOT NULL,
    content_id      UUID NOT NULL,                         -- machine/challenge/dojo_level ID
    region_preference TEXT,
    priority        INT NOT NULL DEFAULT 0,                -- Higher = sooner (VIP > free)
    queued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL,                  -- Give up after this
    status          TEXT NOT NULL DEFAULT 'queued',        -- queued|processing|fulfilled|expired|canceled
    instance_id     UUID,                                  -- Set when fulfilled
    notification_sent BOOLEAN NOT NULL DEFAULT FALSE,

    CONSTRAINT chk_queue_content CHECK (content_type IN ('machine','challenge','dojo_level','pro_lab')),
    CONSTRAINT chk_queue_status CHECK (status IN ('queued','processing','fulfilled','expired','canceled'))
);

CREATE INDEX idx_queue_status_priority ON lab.spawn_queue (status, priority DESC, queued_at) WHERE status = 'queued';
CREATE INDEX idx_queue_user ON lab.spawn_queue (user_id) WHERE status = 'queued';

-- ---------------------------------------------------------------------------
-- Image Registry Cache (track which images are pre-pulled where)
-- ---------------------------------------------------------------------------
CREATE TABLE lab.image_cache (
    node_id         TEXT NOT NULL REFERENCES lab.nodes(id) ON DELETE CASCADE,
    image_ref       TEXT NOT NULL,
    image_size_mb   INT,
    pulled_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    use_count       BIGINT NOT NULL DEFAULT 1,

    PRIMARY KEY (node_id, image_ref)
);

CREATE INDEX idx_image_cache_ref ON lab.image_cache (image_ref);
CREATE INDEX idx_image_cache_lru ON lab.image_cache (last_used_at);  -- For LRU eviction
