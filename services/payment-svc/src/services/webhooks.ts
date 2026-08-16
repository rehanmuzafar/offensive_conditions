/**
 * Stripe webhook handler.
 *
 * Receives signed events from Stripe and reconciles local state. Strategy:
 *   1. Verify the signature using `STRIPE_WEBHOOK_SECRET` (raw body required)
 *   2. Dedupe by `event.id` via Redis (7-day TTL)
 *   3. Persist the raw event to `payment.webhook_events`
 *   4. Dispatch to the appropriate handler by `event.type`
 *   5. Mark processed; on error, leave for replay
 *
 * Heavy work is offloaded to BullMQ workers (`webhook-processing` queue),
 * but the simple mirroring (subscription/invoice/charge state) happens inline.
 */

import type Stripe from 'stripe';

import { getConfig } from '@/config/index.js';
import { AppError, ErrorCode } from '@/config/errors.js';
import { getLogger } from '@/config/logger.js';
import { getRedis } from '@/clients/redis.js';
import { getStripe } from '@/clients/stripe.js';
import { query } from '@/db/pool.js';
import type { InvoiceStatus, SubscriptionStatus } from '@/models/rows.js';

import { getCustomerByStripeId } from './customers.js';
import { getPlanByCode } from './plans.js';
import { upsertFromStripe as upsertSubscription } from './subscriptions.js';
import { upsertFromStripe as upsertInvoice } from './invoices.js';
import { recordTransaction, getTransactionByProviderId } from './transactions.js';
import { publishPaymentEvent } from './kafka.js';

const log = getLogger('webhooks');


export function verifySignature(rawBody: Buffer, signature: string): Stripe.Event {
  const cfg = getConfig();
  const stripe = getStripe();
  try {
    return stripe.webhooks.constructEvent(rawBody, signature, cfg.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    log.warn({ err }, 'webhook_signature_invalid');
    throw new AppError(ErrorCode.WEBHOOK_SIGNATURE_INVALID, 'invalid webhook signature');
  }
}

export async function isDuplicate(eventId: string): Promise<boolean> {
  const cfg = getConfig();
  const redis = getRedis();
  const ttlSeconds = cfg.WEBHOOK_DEDUP_TTL_DAYS * 24 * 3600;
  // SET key value NX EX ttl — returns "OK" if new, null if existed
  const result = await redis.set(`webhook:stripe:${eventId}`, '1', 'EX', ttlSeconds, 'NX');
  return result === null;
}

export async function persistEvent(event: Stripe.Event): Promise<string> {
  const result = await query<{ id: string }>(
    `
    INSERT INTO payment.webhook_events (
      provider, event_id, event_type, payload, signature_verified, processed
    )
    VALUES ('stripe', $1, $2, $3::JSONB, TRUE, FALSE)
    ON CONFLICT (provider, event_id) DO UPDATE SET event_type = EXCLUDED.event_type
    RETURNING id
    `,
    [event.id, event.type, JSON.stringify(event)],
  );
  return result.rows[0]!.id;
}

export async function markProcessed(
  webhookRowId: string,
  errorMessage?: string,
): Promise<void> {
  await query(
    `
    UPDATE payment.webhook_events
       SET processed = $1,
           processing_error = $2,
           processed_at = NOW()
     WHERE id = $3
    `,
    [!errorMessage, errorMessage ?? null, webhookRowId],
  );
}

// =============================================================================
// Dispatch
// =============================================================================

export async function dispatch(event: Stripe.Event): Promise<void> {
  log.info({ event_id: event.id, event_type: event.type }, 'webhook_received');

  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
      break;

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await handleSubscriptionUpsert(event.data.object as Stripe.Subscription);
      break;

    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
      break;

    case 'invoice.created':
    case 'invoice.finalized':
    case 'invoice.updated':
    case 'invoice.paid':
    case 'invoice.payment_failed':
    case 'invoice.voided':
      await handleInvoiceUpsert(event.data.object as Stripe.Invoice);
      break;

    case 'charge.succeeded':
      await handleChargeSucceeded(event.data.object as Stripe.Charge);
      break;
    case 'charge.failed':
      await handleChargeFailed(event.data.object as Stripe.Charge);
      break;
    case 'charge.refunded':
      await handleChargeRefunded(event.data.object as Stripe.Charge);
      break;
    case 'charge.dispute.created':
      await handleDisputeCreated(event.data.object as Stripe.Dispute);
      break;

    case 'payment_intent.succeeded':
    case 'payment_intent.payment_failed':
      // We mostly handle these via the charge.* events
      log.debug({ event_type: event.type }, 'webhook_noop');
      break;

    default:
      log.debug({ event_type: event.type }, 'webhook_unhandled');
  }
}

// =============================================================================
// Handlers
// =============================================================================

async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const userId = session.metadata?.offcon_user_id;
  const planCode = session.metadata?.offcon_plan_code;
  if (!userId || !planCode) {
    log.warn({ session_id: session.id }, 'checkout_session_missing_metadata');
    return;
  }
  log.info(
    {
      session_id: session.id,
      user_id: userId,
      plan_code: planCode,
      mode: session.mode,
    },
    'checkout_session_completed',
  );
  // Subscription will arrive via customer.subscription.created.
  // Lifetime payments are recorded as a one-off charge — we'll see the charge.succeeded.
}

async function handleSubscriptionUpsert(sub: Stripe.Subscription): Promise<void> {
  const userIdFromMeta = sub.metadata?.offcon_user_id;
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;

  let userId: string | null = userIdFromMeta ?? null;
  if (!userId) {
    const customer = await getCustomerByStripeId(customerId);
    if (!customer) {
      log.warn({ stripe_customer_id: customerId }, 'webhook_unknown_customer');
      return;
    }
    userId = customer.user_id;
  }

  const planCode = sub.metadata?.offcon_plan_code;
  if (!planCode) {
    log.warn({ subscription_id: sub.id }, 'subscription_missing_plan_code');
    return;
  }
  const plan = await getPlanByCode(planCode);

  const item = sub.items.data[0];
  const priceCents = item?.price.unit_amount ?? plan.base_price_cents;
  const currency = item?.price.currency.toUpperCase() ?? plan.currency;

  const upserted = await upsertSubscription({
    userId,
    planId: plan.id,
    providerSubscriptionId: sub.id,
    status: sub.status as SubscriptionStatus,
    trialStartAt: sub.trial_start ? new Date(sub.trial_start * 1000) : null,
    trialEndAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
    currentPeriodStart: new Date((sub.current_period_start ?? Math.floor(Date.now() / 1000)) * 1000),
    currentPeriodEnd: new Date((sub.current_period_end ?? Math.floor(Date.now() / 1000)) * 1000),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
    cancellationReason: sub.cancellation_details?.reason ?? null,
    endedAt: sub.ended_at ? new Date(sub.ended_at * 1000) : null,
    priceCentsAtSignup: priceCents,
    currencyAtSignup: currency,
    couponId: null,
    discountCents: 0,
    metadata: { ...(sub.metadata ?? {}) },
  });

  await publishPaymentEvent('payment.subscription.updated', {
    subscription_id: upserted.id,
    user_id: userId,
    plan_code: plan.code,
    status: upserted.status,
  });
}

async function handleSubscriptionDeleted(sub: Stripe.Subscription): Promise<void> {
  await handleSubscriptionUpsert(sub);
  await publishPaymentEvent('payment.subscription.canceled', {
    provider_subscription_id: sub.id,
    canceled_at: sub.canceled_at,
  });
}

async function handleInvoiceUpsert(invoice: Stripe.Invoice): Promise<void> {
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
  if (!customerId) {
    log.warn({ invoice_id: invoice.id }, 'invoice_missing_customer');
    return;
  }
  const customer = await getCustomerByStripeId(customerId);
  if (!customer) {
    log.warn({ stripe_customer_id: customerId }, 'invoice_unknown_customer');
    return;
  }

  let subscriptionId: string | null = null;
  const subRel = (invoice as unknown as { subscription?: string | Stripe.Subscription }).subscription;
  const subId = typeof subRel === 'string' ? subRel : subRel?.id;
  if (subId) {
    const result = await query<{ id: string }>(
      `SELECT id FROM payment.subscriptions WHERE provider_subscription_id = $1`,
      [subId],
    );
    subscriptionId = result.rows[0]?.id ?? null;
  }

  await upsertInvoice({
    userId: customer.user_id,
    subscriptionId,
    customerId: customer.id,
    number: invoice.number ?? null,
    providerInvoiceId: invoice.id!,
    status: invoice.status as InvoiceStatus,
    amountDueCents: invoice.amount_due ?? 0,
    amountPaidCents: invoice.amount_paid ?? 0,
    amountRemainingCents: invoice.amount_remaining ?? 0,
    subtotalCents: invoice.subtotal ?? 0,
    taxCents: invoice.tax ?? 0,
    discountCents: invoice.total_discount_amounts?.reduce((acc, d) => acc + d.amount, 0) ?? 0,
    totalCents: invoice.total ?? 0,
    currency: (invoice.currency ?? 'usd').toUpperCase(),
    periodStart:
      invoice.period_start && invoice.period_start > 0 ? new Date(invoice.period_start * 1000) : null,
    periodEnd:
      invoice.period_end && invoice.period_end > 0 ? new Date(invoice.period_end * 1000) : null,
    dueAt: invoice.due_date ? new Date(invoice.due_date * 1000) : null,
    paidAt:
      invoice.status === 'paid' && invoice.status_transitions?.paid_at
        ? new Date(invoice.status_transitions.paid_at * 1000)
        : null,
    voidedAt: invoice.status_transitions?.voided_at
      ? new Date(invoice.status_transitions.voided_at * 1000)
      : null,
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
    invoicePdfUrl: invoice.invoice_pdf ?? null,
    metadata: invoice.metadata ?? {},
  });

  if (invoice.status === 'paid') {
    await publishPaymentEvent('payment.invoice.paid', {
      provider_invoice_id: invoice.id,
      user_id: customer.user_id,
      total_cents: invoice.total ?? 0,
      currency: (invoice.currency ?? 'usd').toUpperCase(),
    });
  } else if (invoice.status === 'open' && (invoice.attempt_count ?? 0) > 0) {
    await publishPaymentEvent('payment.invoice.failed', {
      provider_invoice_id: invoice.id,
      user_id: customer.user_id,
      attempt_count: invoice.attempt_count,
    });
  }
}

async function handleChargeSucceeded(charge: Stripe.Charge): Promise<void> {
  const customerId = typeof charge.customer === 'string' ? charge.customer : charge.customer?.id;
  if (!customerId) {
    log.warn({ charge_id: charge.id }, 'charge_missing_customer');
    return;
  }
  const customer = await getCustomerByStripeId(customerId);
  if (!customer) {
    log.warn({ stripe_customer_id: customerId }, 'charge_unknown_customer');
    return;
  }

  // Dedupe via provider_txn_id
  const existing = await getTransactionByProviderId(charge.id);
  if (existing) {
    log.debug({ charge_id: charge.id, txn_id: existing.id }, 'charge_already_recorded');
    return;
  }

  let invoiceId: string | null = null;
  const chargeWithInvoice = charge as unknown as { invoice?: string | Stripe.Invoice };
  const invoiceFromCharge = chargeWithInvoice.invoice;
  if (invoiceFromCharge) {
    const stripeInvId = typeof invoiceFromCharge === 'string' ? invoiceFromCharge : invoiceFromCharge.id;
    const result = await query<{ id: string; subscription_id: string | null }>(
      `SELECT id, subscription_id FROM payment.invoices WHERE provider_invoice_id = $1`,
      [stripeInvId],
    );
    invoiceId = result.rows[0]?.id ?? null;
  }

  const txn = await recordTransaction({
    userId: customer.user_id,
    invoiceId,
    transactionType: 'charge',
    amountCents: charge.amount,
    currency: charge.currency.toUpperCase(),
    feeCents: charge.application_fee_amount ?? 0,
    providerTxnId: charge.id,
    status: 'succeeded',
    completedAt: new Date((charge.created ?? Date.now() / 1000) * 1000),
    description: charge.description,
    metadata: { stripe_payment_intent: charge.payment_intent, balance_txn: charge.balance_transaction },
  });

  await publishPaymentEvent('payment.charge.succeeded', {
    transaction_id: txn.id,
    user_id: customer.user_id,
    amount_cents: charge.amount,
    currency: charge.currency.toUpperCase(),
  });
}

async function handleChargeFailed(charge: Stripe.Charge): Promise<void> {
  const customerId = typeof charge.customer === 'string' ? charge.customer : charge.customer?.id;
  if (!customerId) return;
  const customer = await getCustomerByStripeId(customerId);
  if (!customer) return;

  const existing = await getTransactionByProviderId(charge.id);
  if (existing) return;

  await recordTransaction({
    userId: customer.user_id,
    transactionType: 'charge',
    amountCents: charge.amount,
    currency: charge.currency.toUpperCase(),
    providerTxnId: charge.id,
    status: 'failed',
    failureCode: charge.failure_code,
    failureMessage: charge.failure_message,
    description: charge.description,
    metadata: { stripe_payment_intent: charge.payment_intent },
  });
}

async function handleChargeRefunded(charge: Stripe.Charge): Promise<void> {
  // Process each refund on the charge; dedupe via provider_txn_id (refund id)
  if (!charge.refunds) return;
  const customerId = typeof charge.customer === 'string' ? charge.customer : charge.customer?.id;
  if (!customerId) return;
  const customer = await getCustomerByStripeId(customerId);
  if (!customer) return;

  let invoiceId: string | null = null;
  const chargeWithInvoice = charge as unknown as { invoice?: string | Stripe.Invoice };
  const invoiceFromCharge = chargeWithInvoice.invoice;
  if (invoiceFromCharge) {
    const stripeInvId = typeof invoiceFromCharge === 'string' ? invoiceFromCharge : invoiceFromCharge.id;
    const result = await query<{ id: string }>(
      `SELECT id FROM payment.invoices WHERE provider_invoice_id = $1`,
      [stripeInvId],
    );
    invoiceId = result.rows[0]?.id ?? null;
  }

  for (const refund of charge.refunds.data) {
    const existing = await getTransactionByProviderId(refund.id);
    if (existing) continue;

    await recordTransaction({
      userId: customer.user_id,
      invoiceId,
      transactionType: 'refund',
      amountCents: -Math.abs(refund.amount),
      currency: refund.currency.toUpperCase(),
      providerTxnId: refund.id,
      status: refund.status === 'succeeded' ? 'succeeded' : 'pending',
      completedAt: refund.status === 'succeeded' ? new Date(refund.created * 1000) : null,
      description: `Refund of charge ${charge.id}`,
      metadata: {
        source_charge: charge.id,
        reason: refund.reason ?? undefined,
        ...refund.metadata,
      },
    });

    await publishPaymentEvent('payment.refund.issued', {
      provider_refund_id: refund.id,
      user_id: customer.user_id,
      amount_cents: refund.amount,
    });
  }
}

async function handleDisputeCreated(dispute: Stripe.Dispute): Promise<void> {
  const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge.id;
  const txn = await getTransactionByProviderId(chargeId);
  if (!txn) {
    log.warn({ dispute_id: dispute.id, charge_id: chargeId }, 'dispute_charge_not_found');
    return;
  }

  // Record as separate chargeback row (don't mutate the charge txn directly)
  await recordTransaction({
    userId: txn.user_id,
    invoiceId: txn.invoice_id,
    subscriptionId: txn.subscription_id,
    transactionType: 'chargeback',
    amountCents: -Math.abs(dispute.amount),
    currency: dispute.currency.toUpperCase(),
    providerTxnId: dispute.id,
    status: 'disputed',
    description: `Dispute on charge ${chargeId}: ${dispute.reason}`,
    metadata: {
      dispute_reason: dispute.reason,
      dispute_status: dispute.status,
      evidence_due_by: dispute.evidence_details?.due_by,
    },
  });

  await publishPaymentEvent('payment.dispute.created', {
    dispute_id: dispute.id,
    user_id: txn.user_id,
    amount_cents: dispute.amount,
    reason: dispute.reason,
  });
}
