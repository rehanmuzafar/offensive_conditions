-- =============================================================================
-- Audit Schema — Initial Migration
-- =============================================================================
-- Immutable audit log for security and compliance.
-- INSERT-only. UPDATE/DELETE explicitly revoked from all roles.
-- =============================================================================

SET search_path = audit, public;

-- ---------------------------------------------------------------------------
-- Audit Log (security-relevant events from all services)
-- ---------------------------------------------------------------------------
CREATE TABLE audit.log (
    id              UUID NOT NULL DEFAULT public.uuid_generate_v7(),
    -- Who
    actor_type      TEXT NOT NULL,                         -- user|admin|system|api_key|anonymous
    actor_id        UUID,
    actor_ip        INET,
    actor_user_agent TEXT,
    -- What
    action          TEXT NOT NULL,                         -- e.g. 'user.login', 'admin.user.ban', 'instance.spawn'
    category        TEXT NOT NULL,                         -- auth|admin|content|lab|payment|security
    severity        TEXT NOT NULL DEFAULT 'info',          -- debug|info|notice|warning|error|critical|alert|emergency
    -- Target (the affected resource)
    target_type     TEXT,                                  -- user|machine|instance|subscription|...
    target_id       UUID,
    -- Source service
    service         TEXT NOT NULL,                         -- auth|user|content|orchestrator|...
    request_id      TEXT,                                  -- For correlation with logs/traces
    -- Result
    outcome         TEXT NOT NULL,                         -- success|failure|denied|partial
    status_code     INT,
    error_message   TEXT,
    -- Details
    metadata        JSONB DEFAULT '{}'::JSONB,             -- Action-specific structured data
    diff            JSONB,                                 -- Before/after for state-changing actions
    -- When
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_actor_type CHECK (actor_type IN ('user','admin','system','api_key','anonymous')),
    CONSTRAINT chk_severity CHECK (severity IN ('debug','info','notice','warning','error','critical','alert','emergency')),
    CONSTRAINT chk_outcome CHECK (outcome IN ('success','failure','denied','partial')),

    PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

-- Monthly partitions
CREATE TABLE audit.log_2026_05 PARTITION OF audit.log
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE audit.log_2026_06 PARTITION OF audit.log
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE audit.log_2026_07 PARTITION OF audit.log
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

CREATE INDEX idx_audit_actor ON audit.log (actor_id, occurred_at DESC);
CREATE INDEX idx_audit_target ON audit.log (target_type, target_id, occurred_at DESC);
CREATE INDEX idx_audit_action ON audit.log (action, occurred_at DESC);
CREATE INDEX idx_audit_category_severity ON audit.log (category, severity, occurred_at DESC);
CREATE INDEX idx_audit_ip ON audit.log (actor_ip, occurred_at DESC);
CREATE INDEX idx_audit_request_id ON audit.log (request_id) WHERE request_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Enforce immutability
-- ---------------------------------------------------------------------------
-- Once written, audit entries cannot be modified.
-- This is enforced via REVOKE in cluster init AND via rules below.

CREATE OR REPLACE RULE audit_log_no_update AS
    ON UPDATE TO audit.log
    DO INSTEAD NOTHING;

CREATE OR REPLACE RULE audit_log_no_delete AS
    ON DELETE TO audit.log
    DO INSTEAD NOTHING;

COMMENT ON TABLE audit.log IS 'INSERT-only. Updates and deletes silently dropped via rules. Also enforce via role permissions.';

-- ---------------------------------------------------------------------------
-- Admin Actions (subset of audit log for admin dashboard convenience)
-- ---------------------------------------------------------------------------
CREATE TABLE audit.admin_actions (
    id              UUID NOT NULL DEFAULT public.uuid_generate_v7(),
    admin_id        UUID NOT NULL,
    action          TEXT NOT NULL,
    target_type     TEXT,
    target_id       UUID,
    reason          TEXT NOT NULL,                         -- Admins must provide a reason
    metadata        JSONB DEFAULT '{}'::JSONB,
    ip_address      INET NOT NULL,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE audit.admin_actions_2026_05 PARTITION OF audit.admin_actions
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE audit.admin_actions_2026_06 PARTITION OF audit.admin_actions
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

CREATE INDEX idx_admin_actions_admin ON audit.admin_actions (admin_id, occurred_at DESC);
CREATE INDEX idx_admin_actions_target ON audit.admin_actions (target_type, target_id, occurred_at DESC);

CREATE OR REPLACE RULE admin_actions_no_update AS
    ON UPDATE TO audit.admin_actions
    DO INSTEAD NOTHING;
CREATE OR REPLACE RULE admin_actions_no_delete AS
    ON DELETE TO audit.admin_actions
    DO INSTEAD NOTHING;

-- ---------------------------------------------------------------------------
-- Security Events (high-priority subset for SIEM ingestion)
-- ---------------------------------------------------------------------------
CREATE TABLE audit.security_events (
    id              UUID PRIMARY KEY DEFAULT public.uuid_generate_v7(),
    event_type      TEXT NOT NULL,                         -- brute_force|account_takeover|container_escape|...
    severity        TEXT NOT NULL,                         -- info|low|medium|high|critical
    confidence      NUMERIC(5,2),                          -- 0-100
    -- Actors
    user_id         UUID,
    ip_address      INET,
    user_agent      TEXT,
    country_code    CHAR(2),
    -- Detection
    detected_by     TEXT NOT NULL,                         -- waf|rate_limiter|anomaly_detector|falco|manual
    rule_id         TEXT,                                  -- Specific detection rule
    -- Details
    description     TEXT NOT NULL,
    evidence        JSONB NOT NULL DEFAULT '{}'::JSONB,
    -- Response
    action_taken    TEXT,                                  -- alerted|blocked|throttled|account_locked|none
    response_metadata JSONB DEFAULT '{}'::JSONB,
    -- Triage
    triaged         BOOLEAN NOT NULL DEFAULT FALSE,
    triaged_by      UUID,
    triaged_at      TIMESTAMPTZ,
    triage_outcome  TEXT,                                  -- true_positive|false_positive|inconclusive
    triage_notes    TEXT,
    -- When
    detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_sec_severity CHECK (severity IN ('info','low','medium','high','critical'))
);

CREATE INDEX idx_security_events_user ON audit.security_events (user_id, detected_at DESC);
CREATE INDEX idx_security_events_ip ON audit.security_events (ip_address, detected_at DESC);
CREATE INDEX idx_security_events_untriaged ON audit.security_events (severity DESC, detected_at) WHERE triaged = FALSE;
CREATE INDEX idx_security_events_type ON audit.security_events (event_type, detected_at DESC);
