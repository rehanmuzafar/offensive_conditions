/**
 * 20260526_0001_payment_indexes.ts
 *
 * Phase 2 created the payment schema and base tables. This migration adds
 * indexes optimised for the read paths exercised by payment-svc.
 */

import type { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Active subscriptions per user — hot path for tier checks
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_subscriptions_user_active
      ON payment.subscriptions (user_id)
      WHERE status IN ('trialing','active','past_due')
  `);

  // Provider subscription lookup (webhooks)
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_subscriptions_provider_id
      ON payment.subscriptions (provider, provider_subscription_id)
      WHERE provider_subscription_id IS NOT NULL
  `);

  // Customer provider lookup (webhooks)
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_customers_provider_id
      ON payment.customers (provider, provider_customer_id)
      WHERE provider_customer_id IS NOT NULL
  `);

  // Invoice lookup
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_invoices_user_created
      ON payment.invoices (user_id, created_at DESC)
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_invoices_provider_id
      ON payment.invoices (provider_invoice_id)
      WHERE provider_invoice_id IS NOT NULL
  `);

  // Transactions per user, with type/status filter
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_transactions_user_initiated
      ON payment.transactions (user_id, initiated_at DESC)
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_transactions_provider_id
      ON payment.transactions (provider_txn_id)
      WHERE provider_txn_id IS NOT NULL
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_transactions_idempotency
      ON payment.transactions (idempotency_key)
      WHERE idempotency_key IS NOT NULL
  `);

  // Coupon lookup
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_user
      ON payment.coupon_redemptions (user_id, coupon_id)
  `);

  // Webhook event dedup (Postgres-side fallback if Redis missed)
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_webhook_events_event_id
      ON payment.webhook_events (provider, event_id)
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_webhook_events_unprocessed
      ON payment.webhook_events (received_at DESC)
      WHERE processed = FALSE
  `);

  // Plan listings — sort + active filter
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_plans_active_sort
      ON payment.plans (sort_order ASC, base_price_cents ASC)
      WHERE is_active = TRUE
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP INDEX IF EXISTS payment.idx_plans_active_sort`);
  pgm.sql(`DROP INDEX IF EXISTS payment.idx_webhook_events_unprocessed`);
  pgm.sql(`DROP INDEX IF EXISTS payment.idx_webhook_events_event_id`);
  pgm.sql(`DROP INDEX IF EXISTS payment.idx_coupon_redemptions_user`);
  pgm.sql(`DROP INDEX IF EXISTS payment.idx_transactions_idempotency`);
  pgm.sql(`DROP INDEX IF EXISTS payment.idx_transactions_provider_id`);
  pgm.sql(`DROP INDEX IF EXISTS payment.idx_transactions_user_initiated`);
  pgm.sql(`DROP INDEX IF EXISTS payment.idx_invoices_provider_id`);
  pgm.sql(`DROP INDEX IF EXISTS payment.idx_invoices_user_created`);
  pgm.sql(`DROP INDEX IF EXISTS payment.idx_customers_provider_id`);
  pgm.sql(`DROP INDEX IF EXISTS payment.idx_subscriptions_provider_id`);
  pgm.sql(`DROP INDEX IF EXISTS payment.idx_subscriptions_user_active`);
}
