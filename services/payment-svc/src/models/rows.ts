/**
 * TypeScript shapes mirroring the Phase 2 `payment` schema tables.
 *
 * Date columns from `pg` arrive as `Date` (via the default type parser);
 * we model them accordingly. JSONB columns are typed as `unknown` at the
 * boundary and narrowed where consumed.
 */

export type PlanTier = 'free' | 'vip' | 'vip_plus' | 'team' | 'enterprise';
export type BillingCycle = 'monthly' | 'annual' | 'lifetime' | 'usage';
export type Provider = 'stripe' | 'jazzcash' | 'easypaisa' | 'paypal' | 'manual';
export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'incomplete';
export type TransactionType = 'charge' | 'refund' | 'adjustment' | 'chargeback' | 'payout';
export type TransactionStatus = 'pending' | 'succeeded' | 'failed' | 'refunded' | 'disputed';
export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';
export type CouponDiscountType = 'percent' | 'fixed';
export type RiskLevel = 'low' | 'medium' | 'high' | 'blocked';

export interface PlanRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  tier: PlanTier;
  billing_cycle: BillingCycle;
  base_price_cents: number;
  currency: string;
  regional_pricing: Record<string, { price_cents: number; currency: string }> | null;
  stripe_product_id: string | null;
  stripe_price_id: string | null;
  features: string[] | null;
  max_concurrent_instances: number | null;
  max_daily_spawns: number | null;
  is_active: boolean;
  is_legacy: boolean;
  available_from: Date | null;
  available_until: Date | null;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
}

export interface CustomerRow {
  id: string;
  user_id: string;
  provider: Provider;
  provider_customer_id: string | null;
  email: string;
  name: string | null;
  billing_address: Record<string, unknown> | null;
  tax_id: string | null;
  tax_exempt: 'none' | 'exempt' | 'reverse';
  default_payment_method_id: string | null;
  preferred_currency: string;
  preferred_locale: string;
  region_code: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

export interface PaymentMethodRow {
  id: string;
  customer_id: string;
  provider: Provider;
  provider_pm_id: string | null;
  type: string;
  brand: string | null;
  last4: string | null;
  exp_month: number | null;
  exp_year: number | null;
  is_default: boolean;
  is_active: boolean;
  metadata: Record<string, unknown> | null;
  created_at: Date;
}

export interface SubscriptionRow {
  id: string;
  user_id: string;
  plan_id: string;
  provider: Provider;
  provider_subscription_id: string | null;
  status: SubscriptionStatus;
  trial_start_at: Date | null;
  trial_end_at: Date | null;
  current_period_start: Date;
  current_period_end: Date;
  cancel_at_period_end: boolean;
  canceled_at: Date | null;
  cancellation_reason: string | null;
  ended_at: Date | null;
  price_cents_at_signup: number;
  currency_at_signup: string;
  coupon_id: string | null;
  discount_cents: number;
  metadata: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

export interface InvoiceRow {
  id: string;
  user_id: string;
  subscription_id: string | null;
  customer_id: string | null;
  number: string | null;
  provider: Provider;
  provider_invoice_id: string | null;
  status: InvoiceStatus;
  amount_due_cents: number;
  amount_paid_cents: number;
  amount_remaining_cents: number;
  subtotal_cents: number;
  tax_cents: number;
  discount_cents: number;
  total_cents: number;
  currency: string;
  period_start: Date | null;
  period_end: Date | null;
  due_at: Date | null;
  paid_at: Date | null;
  voided_at: Date | null;
  hosted_invoice_url: string | null;
  invoice_pdf_url: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

export interface TransactionRow {
  id: string;
  user_id: string;
  invoice_id: string | null;
  subscription_id: string | null;
  transaction_type: TransactionType;
  amount_cents: number;
  currency: string;
  fee_cents: number;
  net_cents: number;
  provider: Provider;
  provider_txn_id: string | null;
  payment_method_id: string | null;
  status: TransactionStatus;
  failure_code: string | null;
  failure_message: string | null;
  risk_score: string | null;
  risk_level: RiskLevel | null;
  idempotency_key: string | null;
  initiated_at: Date;
  completed_at: Date | null;
  description: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
}

export interface CouponRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  discount_type: CouponDiscountType;
  discount_value: number;
  currency: string | null;
  duration: 'once' | 'repeating' | 'forever';
  duration_in_months: number | null;
  max_redemptions: number | null;
  max_redemptions_per_user: number;
  applies_to_plans: string[] | null;
  valid_from: Date;
  valid_until: Date | null;
  redemption_count: number;
  is_active: boolean;
  created_at: Date;
}

export interface CouponRedemptionRow {
  id: string;
  coupon_id: string;
  user_id: string;
  subscription_id: string | null;
  invoice_id: string | null;
  amount_discounted_cents: number;
  redeemed_at: Date;
}

export interface WebhookEventRow {
  id: string;
  provider: Provider;
  event_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  signature_verified: boolean;
  processed: boolean;
  processing_error: string | null;
  processed_at: Date | null;
  received_at: Date;
}
