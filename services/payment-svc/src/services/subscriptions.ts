/**
 * Subscription service: mirror + manage Stripe subscriptions.
 *
 * Subscription rows are created/updated by Stripe webhook handlers. This
 * service exposes user-facing reads and cancel/resume actions that proxy
 * through Stripe.
 */

import { AppError, ErrorCode } from '@/config/errors.js';
import { getLogger } from '@/config/logger.js';
import { query, withTransaction } from '@/db/pool.js';
import { withStripe } from '@/clients/stripe.js';
import type {
  PlanRow,
  Provider,
  SubscriptionRow,
  SubscriptionStatus,
} from '@/models/rows.js';

const log = getLogger('subscriptions');


export async function getActiveSubscriptionForUser(
  userId: string,
): Promise<{ subscription: SubscriptionRow; plan: PlanRow } | null> {
  const result = await query<SubscriptionRow & { plan_code: string; plan_name: string; plan_tier: string }>(
    `
    SELECT s.*, p.code AS plan_code, p.name AS plan_name, p.tier AS plan_tier
    FROM payment.subscriptions s
    JOIN payment.plans p ON p.id = s.plan_id
    WHERE s.user_id = $1
      AND s.status IN ('trialing','active','past_due')
    ORDER BY s.created_at DESC
    LIMIT 1
    `,
    [userId],
  );
  if (result.rows.length === 0) {
    return null;
  }
  const row = result.rows[0]!;
  const planResult = await query<PlanRow>(`SELECT * FROM payment.plans WHERE id = $1`, [row.plan_id]);
  return { subscription: row, plan: planResult.rows[0]! };
}

export async function getSubscriptionById(id: string): Promise<SubscriptionRow> {
  const result = await query<SubscriptionRow>(
    `SELECT * FROM payment.subscriptions WHERE id = $1`,
    [id],
  );
  if (result.rows.length === 0) {
    throw new AppError(ErrorCode.SUBSCRIPTION_NOT_FOUND, 'subscription not found');
  }
  return result.rows[0]!;
}

export async function getSubscriptionByProviderId(
  providerSubscriptionId: string,
  provider: Provider = 'stripe',
): Promise<SubscriptionRow | null> {
  const result = await query<SubscriptionRow>(
    `SELECT * FROM payment.subscriptions WHERE provider_subscription_id = $1 AND provider = $2`,
    [providerSubscriptionId, provider],
  );
  return result.rows[0] ?? null;
}

export async function listSubscriptionsForUser(userId: string): Promise<SubscriptionRow[]> {
  const result = await query<SubscriptionRow>(
    `SELECT * FROM payment.subscriptions WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
  return result.rows;
}

// =============================================================================
// Cancel / resume (proxy through Stripe; webhook mirrors back)
// =============================================================================

export async function cancelAtPeriodEnd(opts: {
  userId: string;
  cancellationReason?: string;
}): Promise<SubscriptionRow> {
  const active = await getActiveSubscriptionForUser(opts.userId);
  if (!active) {
    throw new AppError(ErrorCode.SUBSCRIPTION_NOT_ACTIVE, 'no active subscription');
  }
  const sub = active.subscription;
  if (sub.cancel_at_period_end) {
    return sub;  // idempotent: already pending cancel
  }
  if (!sub.provider_subscription_id) {
    throw new AppError(ErrorCode.INTERNAL, 'subscription missing provider id');
  }

  // Tell Stripe (webhook will mirror)
  await withStripe(
    (s) =>
      s.subscriptions.update(
        sub.provider_subscription_id!,
        {
          cancel_at_period_end: true,
          cancellation_details: opts.cancellationReason
            ? { comment: opts.cancellationReason.slice(0, 500) }
            : undefined,
          metadata: {
            offcon_canceled_by: opts.userId,
            offcon_cancel_reason: opts.cancellationReason ?? '',
          },
        },
        { idempotencyKey: `sub:cancel:${sub.id}:${Date.now()}` },
      ),
    { description: 'cancel_subscription' },
  );

  // Optimistic local update (webhook will reconcile)
  const updated = await query<SubscriptionRow>(
    `
    UPDATE payment.subscriptions
       SET cancel_at_period_end = TRUE,
           cancellation_reason = $1,
           updated_at = NOW()
     WHERE id = $2
     RETURNING *
    `,
    [opts.cancellationReason ?? null, sub.id],
  );
  log.info({ subscription_id: sub.id, user_id: opts.userId }, 'subscription_marked_for_cancel');
  return updated.rows[0]!;
}

export async function resumeSubscription(userId: string): Promise<SubscriptionRow> {
  const active = await getActiveSubscriptionForUser(userId);
  if (!active) {
    throw new AppError(ErrorCode.SUBSCRIPTION_NOT_ACTIVE, 'no active subscription');
  }
  const sub = active.subscription;
  if (!sub.cancel_at_period_end) {
    throw new AppError(
      ErrorCode.SUBSCRIPTION_ALREADY_ACTIVE,
      'subscription is not pending cancellation',
    );
  }
  if (!sub.provider_subscription_id) {
    throw new AppError(ErrorCode.INTERNAL, 'subscription missing provider id');
  }

  await withStripe(
    (s) =>
      s.subscriptions.update(
        sub.provider_subscription_id!,
        { cancel_at_period_end: false },
        { idempotencyKey: `sub:resume:${sub.id}:${Date.now()}` },
      ),
    { description: 'resume_subscription' },
  );

  const updated = await query<SubscriptionRow>(
    `
    UPDATE payment.subscriptions
       SET cancel_at_period_end = FALSE,
           cancellation_reason = NULL,
           updated_at = NOW()
     WHERE id = $1
     RETURNING *
    `,
    [sub.id],
  );
  log.info({ subscription_id: sub.id, user_id: userId }, 'subscription_resumed');
  return updated.rows[0]!;
}

export async function immediateCancelByAdmin(opts: {
  subscriptionId: string;
  adminId: string;
  reason: string;
}): Promise<SubscriptionRow> {
  const sub = await getSubscriptionById(opts.subscriptionId);
  if (sub.status === 'canceled') {
    throw new AppError(
      ErrorCode.SUBSCRIPTION_ALREADY_CANCELED,
      'subscription already canceled',
    );
  }
  if (sub.provider_subscription_id) {
    await withStripe(
      (s) =>
        s.subscriptions.cancel(
          sub.provider_subscription_id!,
          {
            cancellation_details: { comment: opts.reason.slice(0, 500) },
            invoice_now: false,
            prorate: true,
          },
          { idempotencyKey: `sub:admin_cancel:${sub.id}` },
        ),
      { description: 'admin_cancel_subscription' },
    );
  }

  const updated = await query<SubscriptionRow>(
    `
    UPDATE payment.subscriptions
       SET status = 'canceled',
           canceled_at = NOW(),
           ended_at = NOW(),
           cancellation_reason = $1,
           metadata = COALESCE(metadata, '{}'::JSONB) || jsonb_build_object('admin_id', $2::TEXT),
           updated_at = NOW()
     WHERE id = $3
     RETURNING *
    `,
    [opts.reason, opts.adminId, sub.id],
  );
  log.warn(
    {
      subscription_id: sub.id,
      admin_id: opts.adminId,
      reason: opts.reason,
    },
    'subscription_admin_canceled',
  );
  return updated.rows[0]!;
}

// =============================================================================
// Upsert from webhook (called by webhook handler)
// =============================================================================

/**
 * Insert or update a subscription row from a Stripe subscription object.
 * Called by `customer.subscription.{created,updated,deleted}` webhooks.
 */
export async function upsertFromStripe(opts: {
  userId: string;
  planId: string;
  providerSubscriptionId: string;
  status: SubscriptionStatus;
  trialStartAt: Date | null;
  trialEndAt: Date | null;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  cancellationReason: string | null;
  endedAt: Date | null;
  priceCentsAtSignup: number;
  currencyAtSignup: string;
  couponId: string | null;
  discountCents: number;
  metadata: Record<string, unknown>;
}): Promise<SubscriptionRow> {
  return withTransaction(async (client) => {
    const existing = await client.query<SubscriptionRow>(
      `SELECT * FROM payment.subscriptions WHERE provider_subscription_id = $1 AND provider = 'stripe'`,
      [opts.providerSubscriptionId],
    );
    if (existing.rows.length > 0) {
      const result = await client.query<SubscriptionRow>(
        `
        UPDATE payment.subscriptions
           SET status = $1,
               trial_start_at = $2,
               trial_end_at = $3,
               current_period_start = $4,
               current_period_end = $5,
               cancel_at_period_end = $6,
               canceled_at = $7,
               cancellation_reason = COALESCE($8, cancellation_reason),
               ended_at = $9,
               coupon_id = $10,
               discount_cents = $11,
               metadata = $12::JSONB,
               updated_at = NOW()
         WHERE id = $13
         RETURNING *
        `,
        [
          opts.status,
          opts.trialStartAt,
          opts.trialEndAt,
          opts.currentPeriodStart,
          opts.currentPeriodEnd,
          opts.cancelAtPeriodEnd,
          opts.canceledAt,
          opts.cancellationReason,
          opts.endedAt,
          opts.couponId,
          opts.discountCents,
          JSON.stringify(opts.metadata),
          existing.rows[0]!.id,
        ],
      );
      return result.rows[0]!;
    }
    const result = await client.query<SubscriptionRow>(
      `
      INSERT INTO payment.subscriptions (
        user_id, plan_id, provider, provider_subscription_id,
        status, trial_start_at, trial_end_at,
        current_period_start, current_period_end,
        cancel_at_period_end, canceled_at, cancellation_reason, ended_at,
        price_cents_at_signup, currency_at_signup,
        coupon_id, discount_cents, metadata
      )
      VALUES (
        $1, $2, 'stripe', $3,
        $4, $5, $6,
        $7, $8,
        $9, $10, $11, $12,
        $13, $14,
        $15, $16, $17::JSONB
      )
      RETURNING *
      `,
      [
        opts.userId,
        opts.planId,
        opts.providerSubscriptionId,
        opts.status,
        opts.trialStartAt,
        opts.trialEndAt,
        opts.currentPeriodStart,
        opts.currentPeriodEnd,
        opts.cancelAtPeriodEnd,
        opts.canceledAt,
        opts.cancellationReason,
        opts.endedAt,
        opts.priceCentsAtSignup,
        opts.currencyAtSignup,
        opts.couponId,
        opts.discountCents,
        JSON.stringify(opts.metadata),
      ],
    );
    return result.rows[0]!;
  });
}
