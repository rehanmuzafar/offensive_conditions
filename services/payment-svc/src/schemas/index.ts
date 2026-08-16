/**
 * Request body + response Zod schemas for HTTP endpoints.
 */

import { z } from 'zod';

export const UuidSchema = z.string().uuid();

// =============================================================================
// Plans
// =============================================================================

export const PlanCodeSchema = z.string().regex(/^[a-z0-9_]{2,64}$/);

export const PlanReadSchema = z.object({
  id: UuidSchema,
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  tier: z.string(),
  billing_cycle: z.string(),
  base_price_cents: z.number().int(),
  currency: z.string(),
  regional_price_cents: z.number().int().nullable(),
  regional_currency: z.string().nullable(),
  features: z.array(z.string()).default([]),
  max_concurrent_instances: z.number().int().nullable(),
  max_daily_spawns: z.number().int().nullable(),
  is_active: z.boolean(),
  is_legacy: z.boolean(),
});
export type PlanRead = z.infer<typeof PlanReadSchema>;

export const PlanCreateSchema = z.object({
  code: PlanCodeSchema,
  name: z.string().min(2).max(120),
  description: z.string().max(2000).nullable().optional(),
  tier: z.enum(['free', 'vip', 'vip_plus', 'team', 'enterprise']),
  billing_cycle: z.enum(['monthly', 'annual', 'lifetime', 'usage']),
  base_price_cents: z.number().int().min(0),
  currency: z.string().length(3).default('USD'),
  regional_pricing: z
    .record(z.string(), z.object({ price_cents: z.number().int(), currency: z.string().length(3) }))
    .optional(),
  stripe_product_id: z.string().nullable().optional(),
  stripe_price_id: z.string().nullable().optional(),
  features: z.array(z.string()).default([]),
  max_concurrent_instances: z.number().int().min(0).default(2),
  max_daily_spawns: z.number().int().min(0).default(10),
});

export const PlanUpdateSchema = PlanCreateSchema.partial().extend({
  is_active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});

// =============================================================================
// Checkout
// =============================================================================

export const CheckoutSessionCreateSchema = z.object({
  plan_code: PlanCodeSchema,
  coupon_code: z.string().max(64).optional(),
  return_url: z.string().url().optional(),
  cancel_url: z.string().url().optional(),
  // For non-Stripe providers we'll branch on this; defaults to stripe
  provider: z.enum(['stripe', 'jazzcash', 'easypaisa']).default('stripe'),
});
export type CheckoutSessionCreate = z.infer<typeof CheckoutSessionCreateSchema>;

export const CheckoutSessionResponseSchema = z.object({
  session_id: z.string(),
  checkout_url: z.string().url(),
  expires_at: z.string().datetime(),
});

// =============================================================================
// Customer portal
// =============================================================================

export const PortalSessionCreateSchema = z.object({
  return_url: z.string().url().optional(),
});

export const PortalSessionResponseSchema = z.object({
  portal_url: z.string().url(),
});

// =============================================================================
// Subscription
// =============================================================================

export const SubscriptionReadSchema = z.object({
  id: UuidSchema,
  user_id: UuidSchema,
  plan_id: UuidSchema,
  plan_code: z.string(),
  provider: z.string(),
  status: z.string(),
  trial_start_at: z.string().datetime().nullable(),
  trial_end_at: z.string().datetime().nullable(),
  current_period_start: z.string().datetime(),
  current_period_end: z.string().datetime(),
  cancel_at_period_end: z.boolean(),
  canceled_at: z.string().datetime().nullable(),
  cancellation_reason: z.string().nullable(),
  ended_at: z.string().datetime().nullable(),
  price_cents_at_signup: z.number().int(),
  currency_at_signup: z.string(),
});
export type SubscriptionRead = z.infer<typeof SubscriptionReadSchema>;

export const SubscriptionCancelSchema = z.object({
  cancellation_reason: z.string().max(500).optional(),
});

// =============================================================================
// Invoice
// =============================================================================

export const InvoiceReadSchema = z.object({
  id: UuidSchema,
  user_id: UuidSchema,
  subscription_id: UuidSchema.nullable(),
  number: z.string().nullable(),
  status: z.string(),
  amount_due_cents: z.number().int(),
  amount_paid_cents: z.number().int(),
  total_cents: z.number().int(),
  currency: z.string(),
  period_start: z.string().datetime().nullable(),
  period_end: z.string().datetime().nullable(),
  due_at: z.string().datetime().nullable(),
  paid_at: z.string().datetime().nullable(),
  hosted_invoice_url: z.string().url().nullable(),
  invoice_pdf_url: z.string().url().nullable(),
  created_at: z.string().datetime(),
});

// =============================================================================
// Coupons
// =============================================================================

export const CouponRedeemSchema = z.object({
  code: z.string().min(2).max(64),
  plan_code: PlanCodeSchema.optional(),
});

export const CouponValidationSchema = z.object({
  valid: z.boolean(),
  code: z.string(),
  discount_type: z.enum(['percent', 'fixed']).nullable(),
  discount_value: z.number().nullable(),
  message: z.string().optional(),
});

export const CouponCreateSchema = z.object({
  code: z.string().min(2).max(64),
  name: z.string().min(2).max(120),
  description: z.string().max(500).nullable().optional(),
  discount_type: z.enum(['percent', 'fixed']),
  discount_value: z.number().int().min(0),
  currency: z.string().length(3).nullable().optional(),
  duration: z.enum(['once', 'repeating', 'forever']).default('once'),
  duration_in_months: z.number().int().min(1).max(60).nullable().optional(),
  max_redemptions: z.number().int().min(1).nullable().optional(),
  max_redemptions_per_user: z.number().int().min(1).default(1),
  applies_to_plans: z.array(z.string()).nullable().optional(),
  valid_until: z.string().datetime().nullable().optional(),
});

// =============================================================================
// Refunds
// =============================================================================

export const RefundCreateSchema = z.object({
  transaction_id: UuidSchema.optional(),
  invoice_id: UuidSchema.optional(),
  amount_cents: z.number().int().min(1).optional(),
  reason: z.enum(['requested_by_customer', 'duplicate', 'fraudulent', 'service_issue']),
  notes: z.string().max(2000).optional(),
});
export type RefundCreate = z.infer<typeof RefundCreateSchema>;

// =============================================================================
// Admin queries
// =============================================================================

export const TransactionSearchSchema = z.object({
  user_id: UuidSchema.optional(),
  provider_txn_id: z.string().optional(),
  status: z.string().optional(),
  type: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

// =============================================================================
// Common
// =============================================================================

export const PageMetaSchema = z.object({
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
  has_more: z.boolean(),
});

export type PageMeta = z.infer<typeof PageMetaSchema>;
