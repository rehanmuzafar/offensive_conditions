/**
 * Customer service: maps internal users to Stripe customers.
 *
 * Strategy: on first checkout we create a Stripe customer if one doesn't
 * exist, otherwise reuse the cached `provider_customer_id`. Subscription
 * data lives in `payment.subscriptions`; this file just owns the customer
 * lifecycle.
 */

import { getLogger } from '@/config/logger.js';
import { query } from '@/db/pool.js';
import type { CustomerRow, Provider } from '@/models/rows.js';
import { withStripe } from '@/clients/stripe.js';

const log = getLogger('customers');

export async function getOrCreateStripeCustomer(opts: {
  userId: string;
  email: string;
  name?: string;
  preferredCurrency?: string;
  regionCode?: string;
}): Promise<CustomerRow> {
  // Fast path: existing customer with provider_customer_id
  const existing = await query<CustomerRow>(
    `SELECT * FROM payment.customers WHERE user_id = $1 AND provider = 'stripe' LIMIT 1`,
    [opts.userId],
  );
  if (existing.rows.length > 0 && existing.rows[0]!.provider_customer_id) {
    return existing.rows[0]!;
  }

  // Create or upsert Stripe customer
  const stripeCustomer = await withStripe(
    (s) =>
      s.customers.create(
        {
          email: opts.email,
          name: opts.name,
          metadata: { offcon_user_id: opts.userId, region: opts.regionCode ?? '' },
        },
        { idempotencyKey: `customer:create:${opts.userId}` },
      ),
    { description: 'create_stripe_customer' },
  );

  // Upsert the row
  if (existing.rows.length > 0) {
    const updated = await query<CustomerRow>(
      `
      UPDATE payment.customers
         SET provider_customer_id = $1,
             email = $2,
             name = $3,
             preferred_currency = COALESCE($4, preferred_currency),
             region_code = COALESCE($5, region_code),
             updated_at = NOW()
       WHERE id = $6
       RETURNING *
      `,
      [
        stripeCustomer.id,
        opts.email,
        opts.name ?? null,
        opts.preferredCurrency ?? null,
        opts.regionCode ?? null,
        existing.rows[0]!.id,
      ],
    );
    log.info({ user_id: opts.userId, stripe_id: stripeCustomer.id }, 'customer_linked');
    return updated.rows[0]!;
  }

  const inserted = await query<CustomerRow>(
    `
    INSERT INTO payment.customers (
      user_id, provider, provider_customer_id, email, name,
      preferred_currency, region_code, preferred_locale
    )
    VALUES ($1, 'stripe', $2, $3, $4, $5, $6, 'en-US')
    RETURNING *
    `,
    [
      opts.userId,
      stripeCustomer.id,
      opts.email,
      opts.name ?? null,
      opts.preferredCurrency ?? 'USD',
      opts.regionCode ?? null,
    ],
  );
  log.info({ user_id: opts.userId, stripe_id: stripeCustomer.id }, 'customer_created');
  return inserted.rows[0]!;
}

export async function getCustomerByUserId(
  userId: string,
  provider: Provider = 'stripe',
): Promise<CustomerRow | null> {
  const result = await query<CustomerRow>(
    `SELECT * FROM payment.customers WHERE user_id = $1 AND provider = $2 LIMIT 1`,
    [userId, provider],
  );
  return result.rows[0] ?? null;
}

export async function getCustomerByStripeId(stripeCustomerId: string): Promise<CustomerRow | null> {
  const result = await query<CustomerRow>(
    `SELECT * FROM payment.customers WHERE provider_customer_id = $1 LIMIT 1`,
    [stripeCustomerId],
  );
  return result.rows[0] ?? null;
}
