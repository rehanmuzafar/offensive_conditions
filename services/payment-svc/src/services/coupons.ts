/**
 * Coupon service: validate, redeem, and CRUD coupons.
 *
 * Coupons are stored locally for validation + per-user limits. When created,
 * we also push them to Stripe as `Coupon`/`PromotionCode` so they can be
 * applied on hosted checkout — we store the Stripe IDs in `metadata.stripe_*`.
 */

import { AppError, ErrorCode } from '@/config/errors.js';
import { getLogger } from '@/config/logger.js';
import { query, withTransaction } from '@/db/pool.js';
import { withStripe } from '@/clients/stripe.js';
import type { CouponRow, CouponRedemptionRow } from '@/models/rows.js';

const log = getLogger('coupons');

export interface CouponValidation {
  valid: boolean;
  code: string;
  discount_type: 'percent' | 'fixed' | null;
  discount_value: number | null;
  stripe_coupon_id?: string;
  stripe_promo_id?: string;
  message?: string;
}

export async function getCouponByCode(code: string): Promise<CouponRow> {
  const result = await query<CouponRow>(
    `SELECT * FROM payment.coupons WHERE code = $1`,
    [code.toUpperCase()],
  );
  if (result.rows.length === 0) {
    throw new AppError(ErrorCode.COUPON_NOT_FOUND, 'coupon not found');
  }
  return result.rows[0]!;
}

export async function validateCoupon(
  code: string,
  planCode?: string,
): Promise<CouponValidation> {
  const normalized = code.toUpperCase().trim();
  const result = await query<CouponRow>(
    `SELECT * FROM payment.coupons WHERE code = $1`,
    [normalized],
  );
  if (result.rows.length === 0) {
    return {
      valid: false,
      code: normalized,
      discount_type: null,
      discount_value: null,
      message: 'coupon not found',
    };
  }
  const coupon = result.rows[0]!;
  if (!coupon.is_active) {
    return {
      valid: false,
      code: normalized,
      discount_type: null,
      discount_value: null,
      message: 'coupon is disabled',
    };
  }
  if (coupon.valid_until && coupon.valid_until < new Date()) {
    return {
      valid: false,
      code: normalized,
      discount_type: null,
      discount_value: null,
      message: 'coupon expired',
    };
  }
  if (coupon.valid_from > new Date()) {
    return {
      valid: false,
      code: normalized,
      discount_type: null,
      discount_value: null,
      message: 'coupon not yet active',
    };
  }
  if (coupon.max_redemptions && coupon.redemption_count >= coupon.max_redemptions) {
    return {
      valid: false,
      code: normalized,
      discount_type: null,
      discount_value: null,
      message: 'coupon fully redeemed',
    };
  }
  if (planCode && coupon.applies_to_plans && coupon.applies_to_plans.length > 0) {
    if (!coupon.applies_to_plans.includes(planCode)) {
      return {
        valid: false,
        code: normalized,
        discount_type: null,
        discount_value: null,
        message: 'coupon does not apply to this plan',
      };
    }
  }

  // Look up Stripe IDs from metadata-equivalent columns (description JSONB pattern: we use description column for stripe IDs encoded JSON)
  // Phase 2 schema doesn't include explicit columns; we store via the plans regional_pricing trick.
  // Cleaner: extend the schema. For now, peek for IDs in description.
  let stripeCouponId: string | undefined;
  let stripePromoId: string | undefined;
  if (coupon.description?.startsWith('{') && coupon.description.endsWith('}')) {
    try {
      const meta = JSON.parse(coupon.description) as {
        stripe_coupon_id?: string;
        stripe_promo_id?: string;
      };
      stripeCouponId = meta.stripe_coupon_id;
      stripePromoId = meta.stripe_promo_id;
    } catch {
      // ignore
    }
  }

  return {
    valid: true,
    code: normalized,
    discount_type: coupon.discount_type,
    discount_value: coupon.discount_value,
    stripe_coupon_id: stripeCouponId,
    stripe_promo_id: stripePromoId,
  };
}

export async function checkUserHasRedeemed(
  userId: string,
  couponId: string,
): Promise<number> {
  const result = await query<{ count: string }>(
    `SELECT COUNT(*)::TEXT AS count FROM payment.coupon_redemptions WHERE user_id = $1 AND coupon_id = $2`,
    [userId, couponId],
  );
  return Number(result.rows[0]!.count);
}

export async function redeemCoupon(opts: {
  couponId: string;
  userId: string;
  subscriptionId?: string;
  invoiceId?: string;
  amountDiscountedCents: number;
}): Promise<CouponRedemptionRow> {
  return withTransaction(async (client) => {
    const couponResult = await client.query<CouponRow>(
      `SELECT * FROM payment.coupons WHERE id = $1 FOR UPDATE`,
      [opts.couponId],
    );
    if (couponResult.rows.length === 0) {
      throw new AppError(ErrorCode.COUPON_NOT_FOUND, 'coupon not found');
    }
    const coupon = couponResult.rows[0]!;
    if (coupon.max_redemptions && coupon.redemption_count >= coupon.max_redemptions) {
      throw new AppError(ErrorCode.COUPON_LIMIT_REACHED, 'coupon fully redeemed');
    }

    const userRedemptionsResult = await client.query<{ count: string }>(
      `SELECT COUNT(*)::TEXT AS count FROM payment.coupon_redemptions WHERE user_id = $1 AND coupon_id = $2`,
      [opts.userId, opts.couponId],
    );
    const userRedemptions = Number(userRedemptionsResult.rows[0]!.count);
    if (userRedemptions >= coupon.max_redemptions_per_user) {
      throw new AppError(ErrorCode.COUPON_ALREADY_REDEEMED, 'coupon already redeemed by user');
    }

    const redemption = await client.query<CouponRedemptionRow>(
      `
      INSERT INTO payment.coupon_redemptions (
        coupon_id, user_id, subscription_id, invoice_id, amount_discounted_cents
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
      `,
      [
        opts.couponId,
        opts.userId,
        opts.subscriptionId ?? null,
        opts.invoiceId ?? null,
        opts.amountDiscountedCents,
      ],
    );
    await client.query(
      `UPDATE payment.coupons SET redemption_count = redemption_count + 1 WHERE id = $1`,
      [opts.couponId],
    );
    log.info(
      {
        coupon_id: opts.couponId,
        user_id: opts.userId,
        amount_cents: opts.amountDiscountedCents,
      },
      'coupon_redeemed',
    );
    return redemption.rows[0]!;
  });
}

// =============================================================================
// Admin: create + manage
// =============================================================================

export async function createCoupon(input: {
  code: string;
  name: string;
  description?: string | null;
  discount_type: 'percent' | 'fixed';
  discount_value: number;
  currency?: string | null;
  duration: 'once' | 'repeating' | 'forever';
  duration_in_months?: number | null;
  max_redemptions?: number | null;
  max_redemptions_per_user: number;
  applies_to_plans?: string[] | null;
  valid_until?: Date | null;
}): Promise<CouponRow> {
  const normalizedCode = input.code.toUpperCase();

  // Push to Stripe first
  const stripeCoupon = await withStripe(
    (s) =>
      s.coupons.create(
        {
          name: input.name,
          duration: input.duration,
          duration_in_months: input.duration_in_months ?? undefined,
          ...(input.discount_type === 'percent'
            ? { percent_off: input.discount_value }
            : { amount_off: input.discount_value, currency: (input.currency ?? 'usd').toLowerCase() }),
          max_redemptions: input.max_redemptions ?? undefined,
          redeem_by: input.valid_until ? Math.floor(input.valid_until.getTime() / 1000) : undefined,
          metadata: { offcon_code: normalizedCode },
        },
        { idempotencyKey: `coupon:${normalizedCode}` },
      ),
    { description: 'create_stripe_coupon' },
  );

  // Promotion code (the customer-facing one)
  const stripePromo = await withStripe(
    (s) =>
      s.promotionCodes.create(
        {
          coupon: stripeCoupon.id,
          code: normalizedCode,
          max_redemptions: input.max_redemptions ?? undefined,
          expires_at: input.valid_until ? Math.floor(input.valid_until.getTime() / 1000) : undefined,
          metadata: { offcon_code: normalizedCode },
        },
        { idempotencyKey: `promo:${normalizedCode}` },
      ),
    { description: 'create_stripe_promo_code' },
  );

  // Store Stripe IDs in description JSON (Phase 2 schema doesn't have dedicated cols)
  const descriptionBlob = JSON.stringify({
    stripe_coupon_id: stripeCoupon.id,
    stripe_promo_id: stripePromo.id,
    note: input.description ?? '',
  });

  try {
    const result = await query<CouponRow>(
      `
      INSERT INTO payment.coupons (
        code, name, description,
        discount_type, discount_value, currency,
        duration, duration_in_months,
        max_redemptions, max_redemptions_per_user,
        applies_to_plans, valid_from, valid_until, is_active
      )
      VALUES (
        $1, $2, $3,
        $4, $5, $6,
        $7, $8,
        $9, $10,
        $11, NOW(), $12, TRUE
      )
      RETURNING *
      `,
      [
        normalizedCode,
        input.name,
        descriptionBlob,
        input.discount_type,
        input.discount_value,
        input.currency ?? null,
        input.duration,
        input.duration_in_months ?? null,
        input.max_redemptions ?? null,
        input.max_redemptions_per_user,
        input.applies_to_plans ?? null,
        input.valid_until ?? null,
      ],
    );
    log.info(
      {
        coupon_id: result.rows[0]!.id,
        code: normalizedCode,
        stripe_coupon_id: stripeCoupon.id,
      },
      'coupon_created',
    );
    return result.rows[0]!;
  } catch (err) {
    const pgCode = (err as { code?: string }).code;
    if (pgCode === '23505') {
      throw new AppError(ErrorCode.CONFLICT, 'coupon code already exists');
    }
    throw err;
  }
}
