/**
 * 20260526_0001_notification_schema.ts
 *
 * Creates the `notification` schema and all tables. Phase 2 schema didn't
 * cover notifications because the design hadn't been finalised; this
 * migration ships the canonical layout.
 */

import type { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`CREATE SCHEMA IF NOT EXISTS notification`);
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS "citext"`);

  // ---------------------------------------------------------------------------
  // templates
  // ---------------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE notification.templates (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code            CITEXT NOT NULL UNIQUE,             -- e.g. "auth.welcome", "scoring.first_blood"
      name            TEXT NOT NULL,
      description     TEXT,
      event_type      TEXT NOT NULL,                      -- domain event that triggers this
      channel         TEXT NOT NULL CHECK (channel IN ('email','in_app','webhook','push','sms')),
      locale          TEXT NOT NULL DEFAULT 'en',
      subject         TEXT,                                -- email subject / in-app title (Handlebars)
      body_source     TEXT NOT NULL,                       -- MJML for email, plaintext for sms, json for webhook
      body_compiled   TEXT,                                -- cached HTML for MJML; NULL for non-email
      variables       JSONB NOT NULL DEFAULT '[]'::JSONB,  -- declared template vars for validation
      is_active       BOOLEAN NOT NULL DEFAULT TRUE,
      version         INT NOT NULL DEFAULT 1,
      created_by      UUID,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      UNIQUE (event_type, channel, locale)
    )
  `);

  pgm.sql(`CREATE INDEX idx_templates_event ON notification.templates (event_type, channel, locale) WHERE is_active = TRUE`);

  // ---------------------------------------------------------------------------
  // notifications (in-app)
  // ---------------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE notification.notifications (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id         UUID NOT NULL,
      event_id        TEXT NOT NULL,                       -- source event UUID for dedup
      event_type      TEXT NOT NULL,
      priority        TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
      title           TEXT NOT NULL,
      body            TEXT NOT NULL,
      action_url      TEXT,
      icon            TEXT,
      metadata        JSONB NOT NULL DEFAULT '{}'::JSONB,
      read_at         TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at      TIMESTAMPTZ,

      UNIQUE (user_id, event_id, event_type)
    )
  `);

  pgm.sql(`CREATE INDEX idx_notifications_user_unread ON notification.notifications (user_id, created_at DESC) WHERE read_at IS NULL AND deleted_at IS NULL`);
  pgm.sql(`CREATE INDEX idx_notifications_user_created ON notification.notifications (user_id, created_at DESC) WHERE deleted_at IS NULL`);
  pgm.sql(`CREATE INDEX idx_notifications_event ON notification.notifications (event_id)`);

  // ---------------------------------------------------------------------------
  // preferences
  // ---------------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE notification.preferences (
      user_id           UUID NOT NULL,
      event_type        TEXT NOT NULL,
      email_enabled     BOOLEAN NOT NULL DEFAULT TRUE,
      in_app_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
      push_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
      sms_enabled       BOOLEAN NOT NULL DEFAULT FALSE,
      digest_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
      digest_frequency  TEXT NOT NULL DEFAULT 'daily' CHECK (digest_frequency IN ('daily','weekly','never')),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, event_type)
    )
  `);

  pgm.sql(`
    CREATE TABLE notification.user_settings (
      user_id           UUID PRIMARY KEY,
      timezone          TEXT NOT NULL DEFAULT 'UTC',
      quiet_hours_start SMALLINT NOT NULL DEFAULT 22 CHECK (quiet_hours_start BETWEEN 0 AND 23),
      quiet_hours_end   SMALLINT NOT NULL DEFAULT 7  CHECK (quiet_hours_end BETWEEN 0 AND 23),
      respect_quiet     BOOLEAN NOT NULL DEFAULT TRUE,
      email_address     CITEXT,                            -- denormalised from user-svc for delivery
      preferred_locale  TEXT NOT NULL DEFAULT 'en',
      master_unsubscribe BOOLEAN NOT NULL DEFAULT FALSE,    -- kill-switch for ALL email
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // ---------------------------------------------------------------------------
  // webhooks (outbound integrations)
  // ---------------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE notification.webhooks (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id         UUID NOT NULL,
      name            TEXT NOT NULL,
      url             TEXT NOT NULL,
      secret          TEXT NOT NULL,
      event_types     TEXT[] NOT NULL DEFAULT '{}',         -- '*' = all
      is_active       BOOLEAN NOT NULL DEFAULT TRUE,
      failure_count   INT NOT NULL DEFAULT 0,
      last_success_at TIMESTAMPTZ,
      last_failure_at TIMESTAMPTZ,
      last_failure_msg TEXT,
      disabled_at     TIMESTAMPTZ,                          -- auto-disabled after many failures
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  pgm.sql(`CREATE INDEX idx_webhooks_user ON notification.webhooks (user_id) WHERE is_active = TRUE`);

  // ---------------------------------------------------------------------------
  // deliveries (audit log of every send attempt)
  // ---------------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE notification.deliveries (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id         UUID NOT NULL,
      notification_id UUID REFERENCES notification.notifications(id) ON DELETE SET NULL,
      webhook_id      UUID REFERENCES notification.webhooks(id) ON DELETE SET NULL,
      event_id        TEXT NOT NULL,
      event_type      TEXT NOT NULL,
      channel         TEXT NOT NULL CHECK (channel IN ('email','in_app','webhook','push','sms')),
      provider        TEXT,                                  -- resend|sendgrid|fcm|twilio|self
      provider_msg_id TEXT,
      status          TEXT NOT NULL CHECK (status IN ('pending','sent','delivered','bounced','failed','dropped')),
      attempt         INT NOT NULL DEFAULT 1,
      failure_reason  TEXT,
      latency_ms      INT,
      sent_at         TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  pgm.sql(`CREATE INDEX idx_deliveries_user_created ON notification.deliveries (user_id, created_at DESC)`);
  pgm.sql(`CREATE INDEX idx_deliveries_event ON notification.deliveries (event_id, channel)`);
  pgm.sql(`CREATE INDEX idx_deliveries_status ON notification.deliveries (status, created_at DESC) WHERE status IN ('pending','failed')`);

  // ---------------------------------------------------------------------------
  // consumed_events (Kafka idempotency)
  // ---------------------------------------------------------------------------
  pgm.sql(`
    CREATE TABLE notification.consumed_events (
      event_id        TEXT PRIMARY KEY,                      -- envelope.event_id
      source_topic    TEXT NOT NULL,
      event_type      TEXT NOT NULL,
      kafka_offset    BIGINT,
      kafka_partition INT,
      consumed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  pgm.sql(`CREATE INDEX idx_consumed_topic_offset ON notification.consumed_events (source_topic, kafka_offset DESC)`);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP TABLE IF EXISTS notification.consumed_events`);
  pgm.sql(`DROP TABLE IF EXISTS notification.deliveries`);
  pgm.sql(`DROP TABLE IF EXISTS notification.webhooks`);
  pgm.sql(`DROP TABLE IF EXISTS notification.user_settings`);
  pgm.sql(`DROP TABLE IF EXISTS notification.preferences`);
  pgm.sql(`DROP TABLE IF EXISTS notification.notifications`);
  pgm.sql(`DROP TABLE IF EXISTS notification.templates`);
  pgm.sql(`DROP SCHEMA IF EXISTS notification CASCADE`);
}
