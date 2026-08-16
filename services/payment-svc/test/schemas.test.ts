import { describe, expect, it } from 'vitest';

import {
  CheckoutSessionCreateSchema,
  CouponCreateSchema,
  PlanCreateSchema,
  RefundCreateSchema,
  SubscriptionCancelSchema,
} from '@/schemas/index.js';

describe('PlanCreateSchema', () => {
  it('accepts a valid plan', () => {
    const result = PlanCreateSchema.safeParse({
      code: 'vip_monthly',
      name: 'VIP Monthly',
      tier: 'vip',
      billing_cycle: 'monthly',
      base_price_cents: 1499,
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid tier', () => {
    const result = PlanCreateSchema.safeParse({
      code: 'foo',
      name: 'Foo',
      tier: 'banana',
      billing_cycle: 'monthly',
      base_price_cents: 100,
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid code format', () => {
    const result = PlanCreateSchema.safeParse({
      code: 'BAD CODE',
      name: 'Bad',
      tier: 'vip',
      billing_cycle: 'monthly',
      base_price_cents: 100,
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative price', () => {
    const result = PlanCreateSchema.safeParse({
      code: 'foo',
      name: 'Foo',
      tier: 'vip',
      billing_cycle: 'monthly',
      base_price_cents: -1,
    });
    expect(result.success).toBe(false);
  });
});

describe('CheckoutSessionCreateSchema', () => {
  it('accepts minimal payload', () => {
    const r = CheckoutSessionCreateSchema.safeParse({ plan_code: 'vip_monthly' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.provider).toBe('stripe');
    }
  });

  it('accepts coupon + URLs', () => {
    const r = CheckoutSessionCreateSchema.safeParse({
      plan_code: 'vip_monthly',
      coupon_code: 'LAUNCH20',
      return_url: 'https://app.offensiveconditions.org/done',
      cancel_url: 'https://app.offensiveconditions.org/cancel',
    });
    expect(r.success).toBe(true);
  });
});

describe('RefundCreateSchema', () => {
  it('requires a reason', () => {
    const r = RefundCreateSchema.safeParse({ amount_cents: 100 });
    expect(r.success).toBe(false);
  });

  it('accepts a transaction_id + reason', () => {
    const r = RefundCreateSchema.safeParse({
      transaction_id: '11111111-1111-1111-1111-111111111111',
      reason: 'requested_by_customer',
    });
    expect(r.success).toBe(true);
  });
});

describe('SubscriptionCancelSchema', () => {
  it('accepts empty body', () => {
    const r = SubscriptionCancelSchema.safeParse({});
    expect(r.success).toBe(true);
  });

  it('caps cancellation_reason length', () => {
    const r = SubscriptionCancelSchema.safeParse({
      cancellation_reason: 'x'.repeat(501),
    });
    expect(r.success).toBe(false);
  });
});

describe('CouponCreateSchema', () => {
  it('accepts a percent coupon', () => {
    const r = CouponCreateSchema.safeParse({
      code: 'LAUNCH20',
      name: 'Launch 20%',
      discount_type: 'percent',
      discount_value: 20,
      duration: 'once',
      max_redemptions_per_user: 1,
    });
    expect(r.success).toBe(true);
  });

  it('accepts a fixed coupon with currency', () => {
    const r = CouponCreateSchema.safeParse({
      code: 'TENOFF',
      name: '$10 off',
      discount_type: 'fixed',
      discount_value: 1000,
      currency: 'USD',
      duration: 'once',
      max_redemptions_per_user: 1,
    });
    expect(r.success).toBe(true);
  });
});
