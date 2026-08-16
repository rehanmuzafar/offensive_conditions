/**
 * Checkout service: creates Stripe Checkout Sessions for subscription signup.
 *
 * Flow:
 *   1. Resolve the plan + Stripe price_id
 *   2. Ensure a Stripe customer exists for this user
 *   3. Apply any valid coupon code
 *   4. Create a hosted checkout session and return the URL
 *
 * The actual subscription row is created in the Stripe webhook handler
 * (`checkout.session.completed`), not here. This keeps a single source of
 * truth: our DB only reflects Stripe events.
 */

import { getConfig } from '@/config/index.js';
import { AppError, ErrorCode } from '@/config/errors.js';
import { getLogger } from '@/config/logger.js';
import { withStripe } from '@/clients/stripe.js';

import type { CheckoutSessionCreate } from '@/schemas/index.js';
import { getOrCreateStripeCustomer } from './customers.js';
import { getPlanByCode } from './plans.js';
import { validateCoupon } from './coupons.js';

const log = getLogger('checkout');

export interface CheckoutSessionResult {
  session_id: string;
  checkout_url: string;
  expires_at: string;  // ISO 8601
}

export async function createCheckoutSession(opts: {
  userId: string;
  userEmail: string;
  userName?: string;
  regionCode?: string;
  input: CheckoutSessionCreate;
}): Promise<CheckoutSessionResult> {
  const cfg = getConfig();
  const plan = await getPlanByCode(opts.input.plan_code);

  if (!plan.is_active) {
    throw new AppError(ErrorCode.PLAN_INACTIVE, 'plan is not currently sold');
  }
  if (!plan.stripe_price_id) {
    throw new AppError(
      ErrorCode.PLAN_INACTIVE,
      'plan is not provisioned in Stripe — admin must set stripe_price_id',
    );
  }

  // Customer
  const customer = await getOrCreateStripeCustomer({
    userId: opts.userId,
    email: opts.userEmail,
    name: opts.userName,
    preferredCurrency: plan.currency,
    regionCode: opts.regionCode,
  });
  if (!customer.provider_customer_id) {
    throw new AppError(ErrorCode.INTERNAL, 'failed to provision Stripe customer');
  }

  // Coupon (optional)
  let discounts: Array<{ coupon: string } | { promotion_code: string }> | undefined;
  if (opts.input.coupon_code) {
    const validation = await validateCoupon(opts.input.coupon_code, opts.input.plan_code);
    if (!validation.valid) {
      throw new AppError(ErrorCode.COUPON_NOT_FOUND, validation.message ?? 'coupon invalid');
    }
    if (validation.stripe_coupon_id) {
      discounts = [{ coupon: validation.stripe_coupon_id }];
    } else if (validation.stripe_promo_id) {
      discounts = [{ promotion_code: validation.stripe_promo_id }];
    }
  }

  const successUrl = opts.input.return_url ?? cfg.STRIPE_RETURN_URL;
  const cancelUrl = opts.input.cancel_url ?? cfg.STRIPE_CANCEL_URL;

  // Lifetime plans are one-time; everything else is recurring
  const mode: 'subscription' | 'payment' =
    plan.billing_cycle === 'lifetime' ? 'payment' : 'subscription';

  const session = await withStripe(
    (s) =>
      s.checkout.sessions.create(
        {
          mode,
          customer: customer.provider_customer_id!,
          payment_method_types: ['card'],
          line_items: [{ price: plan.stripe_price_id!, quantity: 1 }],
          allow_promotion_codes: !discounts,
          discounts,
          subscription_data:
            mode === 'subscription'
              ? {
                  metadata: {
                    offcon_user_id: opts.userId,
                    offcon_plan_code: plan.code,
                    offcon_region: opts.regionCode ?? '',
                  },
                  trial_period_days:
                    cfg.DEFAULT_TRIAL_DAYS > 0 ? cfg.DEFAULT_TRIAL_DAYS : undefined,
                }
              : undefined,
          payment_intent_data:
            mode === 'payment'
              ? {
                  metadata: {
                    offcon_user_id: opts.userId,
                    offcon_plan_code: plan.code,
                  },
                }
              : undefined,
          metadata: {
            offcon_user_id: opts.userId,
            offcon_plan_code: plan.code,
          },
          success_url: successUrl,
          cancel_url: cancelUrl,
          // Tax collection — let Stripe Tax decide
          automatic_tax: { enabled: true },
          customer_update: { address: 'auto', name: 'auto' },
          tax_id_collection: { enabled: true },
          // Expire after 24h
          expires_at: Math.floor(Date.now() / 1000) + 86_400,
        },
        { idempotencyKey: `checkout:${opts.userId}:${plan.code}:${Date.now()}` },
      ),
    { description: 'create_checkout_session' },
  );

  if (!session.url) {
    throw new AppError(ErrorCode.STRIPE_ERROR, 'Stripe did not return a checkout URL');
  }

  log.info(
    {
      session_id: session.id,
      user_id: opts.userId,
      plan_code: plan.code,
      mode,
    },
    'checkout_session_created',
  );

  return {
    session_id: session.id,
    checkout_url: session.url,
    expires_at: new Date(session.expires_at * 1000).toISOString(),
  };
}

export async function createPortalSession(opts: {
  userId: string;
  returnUrl?: string;
}): Promise<{ portal_url: string }> {
  const cfg = getConfig();
  const { getCustomerByUserId } = await import('./customers.js');
  const customer = await getCustomerByUserId(opts.userId, 'stripe');
  if (!customer || !customer.provider_customer_id) {
    throw new AppError(
      ErrorCode.CUSTOMER_NOT_FOUND,
      'no Stripe customer for this user (have you started a checkout yet?)',
    );
  }
  const session = await withStripe(
    (s) =>
      s.billingPortal.sessions.create(
        {
          customer: customer.provider_customer_id!,
          return_url: opts.returnUrl ?? cfg.STRIPE_PORTAL_RETURN_URL,
        },
        { idempotencyKey: `portal:${opts.userId}:${Date.now()}` },
      ),
    { description: 'create_portal_session' },
  );
  return { portal_url: session.url };
}
