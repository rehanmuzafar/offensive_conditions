-- =============================================================================
-- Bounty Schema — Initial Migration
-- =============================================================================
-- Generated from services/bounty-svc/migrations/versions/20260527_0001_bounty_schema.py
-- so the deploy stack's SQL migrator covers bounty like every other schema.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS bounty;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE EXTENSION IF NOT EXISTS citext;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE bounty.programs (
            id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            slug                CITEXT NOT NULL UNIQUE,
            name                TEXT NOT NULL,
            owner_org_id        UUID NOT NULL,
            owner_user_id       UUID NOT NULL,
            description         TEXT NOT NULL,
            policy              TEXT NOT NULL,
            visibility          TEXT NOT NULL DEFAULT 'public'
                CHECK (visibility IN ('public','invite_only','private')),
            status              TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','published','paused','closed')),
            currency            TEXT NOT NULL DEFAULT 'USD',
            min_reward_cents    INT,
            max_reward_cents    INT,
            disclosure_policy   TEXT NOT NULL DEFAULT 'coordinated'
                CHECK (disclosure_policy IN ('coordinated','none','public')),
            response_sla_hours  INT NOT NULL DEFAULT 72,
            triage_sla_hours    INT NOT NULL DEFAULT 168,
            resolution_sla_days INT NOT NULL DEFAULT 90,
            in_scope_summary    TEXT,
            out_of_scope_summary TEXT,
            safe_harbor         BOOLEAN NOT NULL DEFAULT TRUE,
            published_at        TIMESTAMPTZ,
            paused_at           TIMESTAMPTZ,
            closed_at           TIMESTAMPTZ,
            total_reports       INT NOT NULL DEFAULT 0,
            total_payouts_cents BIGINT NOT NULL DEFAULT 0,
            metadata            JSONB NOT NULL DEFAULT '{}'::JSONB,
            created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

CREATE INDEX idx_programs_status ON bounty.programs (status, published_at DESC) WHERE status = 'published';

CREATE INDEX idx_programs_owner ON bounty.programs (owner_org_id, status);

CREATE INDEX idx_programs_name_trgm ON bounty.programs USING gin (name gin_trgm_ops);

CREATE TABLE bounty.program_scope (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            program_id  UUID NOT NULL REFERENCES bounty.programs(id) ON DELETE CASCADE,
            asset_type  TEXT NOT NULL CHECK (asset_type IN ('domain','wildcard','ip','ip_range','mobile_app','source_code','api','other')),
            asset_identifier TEXT NOT NULL,
            severity_max TEXT NOT NULL DEFAULT 'critical'
                CHECK (severity_max IN ('critical','high','medium','low','informational')),
            in_scope    BOOLEAN NOT NULL DEFAULT TRUE,
            notes       TEXT,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

CREATE INDEX idx_scope_program ON bounty.program_scope (program_id, in_scope);

CREATE INDEX idx_scope_asset ON bounty.program_scope (asset_type, asset_identifier);

CREATE TABLE bounty.program_rewards (
            program_id          UUID NOT NULL REFERENCES bounty.programs(id) ON DELETE CASCADE,
            severity            TEXT NOT NULL CHECK (severity IN ('critical','high','medium','low','informational')),
            min_cents           INT NOT NULL,
            max_cents           INT NOT NULL,
            currency            TEXT NOT NULL DEFAULT 'USD',
            updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (program_id, severity)
        );

CREATE TABLE bounty.reports (
            id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            short_id            TEXT NOT NULL UNIQUE,
            program_id          UUID NOT NULL REFERENCES bounty.programs(id),
            researcher_id       UUID NOT NULL,
            title               TEXT NOT NULL,
            description_md      TEXT NOT NULL,
            reproduction_steps  TEXT NOT NULL,
            impact              TEXT NOT NULL,
            asset_identifier    TEXT,
            vrt_category        TEXT,
            severity            TEXT NOT NULL DEFAULT 'medium'
                CHECK (severity IN ('critical','high','medium','low','informational')),
            cvss_vector         TEXT,
            cvss_score          NUMERIC(3,1),
            state               TEXT NOT NULL DEFAULT 'submitted'
                CHECK (state IN ('submitted','triaging','accepted','rejected','duplicate','informational','resolved','paid','closed')),
            triager_id          UUID,
            duplicate_of_id     UUID REFERENCES bounty.reports(id),
            rejection_reason    TEXT,
            internal_notes      TEXT,
            published           BOOLEAN NOT NULL DEFAULT FALSE,
            published_at        TIMESTAMPTZ,
            bounty_cents        INT NOT NULL DEFAULT 0,
            bounty_currency     TEXT,
            triaged_at          TIMESTAMPTZ,
            accepted_at         TIMESTAMPTZ,
            resolved_at         TIMESTAMPTZ,
            paid_at             TIMESTAMPTZ,
            metadata            JSONB NOT NULL DEFAULT '{}'::JSONB,
            created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

CREATE INDEX idx_reports_program ON bounty.reports (program_id, state, created_at DESC);

CREATE INDEX idx_reports_researcher ON bounty.reports (researcher_id, created_at DESC);

CREATE INDEX idx_reports_state ON bounty.reports (state, created_at DESC) WHERE state IN ('submitted','triaging');

CREATE INDEX idx_reports_title_trgm ON bounty.reports USING gin (title gin_trgm_ops);

CREATE TABLE bounty.report_comments (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            report_id       UUID NOT NULL REFERENCES bounty.reports(id) ON DELETE CASCADE,
            author_id       UUID NOT NULL,
            author_role     TEXT NOT NULL CHECK (author_role IN ('researcher','triager','admin','system')),
            visibility      TEXT NOT NULL DEFAULT 'public'
                CHECK (visibility IN ('public','internal')),
            body_md         TEXT NOT NULL,
            body_html       TEXT,
            is_state_change BOOLEAN NOT NULL DEFAULT FALSE,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            edited_at       TIMESTAMPTZ,
            deleted_at      TIMESTAMPTZ
        );

CREATE INDEX idx_report_comments_report ON bounty.report_comments (report_id, created_at ASC) WHERE deleted_at IS NULL;

CREATE TABLE bounty.report_attachments (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            report_id       UUID NOT NULL REFERENCES bounty.reports(id) ON DELETE CASCADE,
            uploader_id     UUID NOT NULL,
            filename        TEXT NOT NULL,
            content_type    TEXT NOT NULL,
            byte_size       BIGINT NOT NULL,
            s3_key          TEXT NOT NULL UNIQUE,
            sha256          TEXT,
            virus_scanned   BOOLEAN NOT NULL DEFAULT FALSE,
            virus_clean     BOOLEAN,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            deleted_at      TIMESTAMPTZ
        );

CREATE INDEX idx_attachments_report ON bounty.report_attachments (report_id) WHERE deleted_at IS NULL;

CREATE TABLE bounty.report_state_transitions (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            report_id       UUID NOT NULL REFERENCES bounty.reports(id) ON DELETE CASCADE,
            actor_id        UUID NOT NULL,
            from_state      TEXT,
            to_state        TEXT NOT NULL,
            reason          TEXT,
            metadata        JSONB NOT NULL DEFAULT '{}'::JSONB,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

CREATE INDEX idx_state_transitions_report ON bounty.report_state_transitions (report_id, created_at ASC);

CREATE TABLE bounty.payouts (
            id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            report_id           UUID NOT NULL REFERENCES bounty.reports(id),
            researcher_id       UUID NOT NULL,
            amount_cents        INT NOT NULL,
            currency            TEXT NOT NULL,
            state               TEXT NOT NULL DEFAULT 'requested'
                CHECK (state IN ('requested','processing','paid','failed','canceled')),
            payment_svc_payout_id TEXT,
            provider_payout_id  TEXT,
            failure_reason      TEXT,
            requested_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            paid_at             TIMESTAMPTZ,
            metadata            JSONB NOT NULL DEFAULT '{}'::JSONB,
            created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

CREATE INDEX idx_payouts_report ON bounty.payouts (report_id);

CREATE INDEX idx_payouts_researcher ON bounty.payouts (researcher_id, created_at DESC);

CREATE INDEX idx_payouts_state ON bounty.payouts (state, created_at DESC);

CREATE UNIQUE INDEX idx_payouts_one_per_report ON bounty.payouts (report_id) WHERE state IN ('requested','processing','paid');

CREATE TABLE bounty.cve_records (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            report_id       UUID NOT NULL REFERENCES bounty.reports(id),
            cve_id          TEXT,
            requested_by    UUID NOT NULL,
            state           TEXT NOT NULL DEFAULT 'requested'
                CHECK (state IN ('requested','reserved','published','rejected')),
            published_at    TIMESTAMPTZ,
            advisory_url    TEXT,
            metadata        JSONB NOT NULL DEFAULT '{}'::JSONB,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

CREATE UNIQUE INDEX idx_cve_records_cve_id ON bounty.cve_records (cve_id) WHERE cve_id IS NOT NULL;

CREATE INDEX idx_cve_records_report ON bounty.cve_records (report_id);
