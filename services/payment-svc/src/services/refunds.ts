/**
 * Refund service: admin-initiated refunds against past charges.
 *
 * Flow:
 *   1. Validate the source (transaction or invoice)
 *   2. Determine refundable amount (charge minus prior refunds)
 *   3. Call Stripe Refund API with idempotency key
 *   4. Record the refund transaction (negative amount)
 *
 * The corresponding webhook (`charge.refunded`) will reconcile later.
 */

import { AppError, ErrorCode } from '@/config/errors.js';
import { getLogger } from '@/config/logger.js';
import { query, withTransaction as withTxn } from '@/db/pool.js';
import { withStripe } from '@/clients/stripe.js';
import type { TransactionRow } from '@/models/rows.js';
import type { RefundCreate } from '@/schemas/index.js';

import { recordTransaction, getTransactionById } from './transactions.js';
import { getInvoiceById } from './invoices.js';

const log = getLogger('refunds');


export async function refundableAmount(transactionId: string): Promise<{
  original_cents: number;
  refunded_cents: number;
  remaining_cents: number;
  currency: string;
}> {
  const txn = await getTransactionById(transactionId);
  if (txn.transaction_type !== 'charge' || txn.status !== 'succeeded') {
    throw new AppError(
      ErrorCode.BAD_REQUEST,
      'transaction is not a successful charge — cannot refund',
    );
  }
  const refundsResult = await query<{ sum: string }>(
    `
    SELECT COALESCE(SUM(ABS(amount_cents)), 0)::TEXT AS sum
    FROM payment.transactions
    WHERE invoice_id = $1
      AND transaction_type = 'refund'
      AND status IN ('pending', 'succeeded')
    `,
    [txn.invoice_id],
  );
  const refunded = Number(refundsResult.rows[0]!.sum);
  return {
    original_cents: txn.amount_cents,
    refunded_cents: refunded,
    remaining_cents: txn.amount_cents - refunded,
    currency: txn.currency,
  };
}

export async function issueRefund(opts: {
  adminId: string;
  input: RefundCreate;
}): Promise<TransactionRow> {
  let originalTxn: TransactionRow;

  if (opts.input.transaction_id) {
    originalTxn = await getTransactionById(opts.input.transaction_id);
  } else if (opts.input.invoice_id) {
    const invoice = await getInvoiceById(opts.input.invoice_id);
    const result = await query<TransactionRow>(
      `
      SELECT * FROM payment.transactions
      WHERE invoice_id = $1
        AND transaction_type = 'charge'
        AND status = 'succeeded'
      ORDER BY initiated_at ASC
      LIMIT 1
      `,
      [invoice.id],
    );
    if (result.rows.length === 0) {
      throw new AppError(ErrorCode.NOT_FOUND, 'no successful charge for this invoice');
    }
    originalTxn = result.rows[0]!;
  } else {
    throw new AppError(
      ErrorCode.BAD_REQUEST,
      'one of transaction_id or invoice_id is required',
    );
  }

  if (originalTxn.transaction_type !== 'charge' || originalTxn.status !== 'succeeded') {
    throw new AppError(
      ErrorCode.BAD_REQUEST,
      'source transaction is not a successful charge',
    );
  }
  if (!originalTxn.provider_txn_id) {
    throw new AppError(
      ErrorCode.STRIPE_ERROR,
      'original charge has no provider_txn_id; cannot refund via Stripe',
    );
  }

  const refundable = await refundableAmount(originalTxn.id);
  const requestedAmount = opts.input.amount_cents ?? refundable.remaining_cents;
  if (requestedAmount > refundable.remaining_cents) {
    throw new AppError(
      ErrorCode.REFUND_AMOUNT_TOO_HIGH,
      `requested ${requestedAmount} cents but only ${refundable.remaining_cents} cents refundable`,
      { remaining_cents: refundable.remaining_cents },
    );
  }
  if (requestedAmount <= 0) {
    throw new AppError(ErrorCode.BAD_REQUEST, 'refund amount must be positive');
  }

  // Stripe refund
  const stripeRefund = await withStripe(
    (s) =>
      s.refunds.create(
        {
          charge: originalTxn.provider_txn_id!,
          amount: requestedAmount,
          reason:
            opts.input.reason === 'requested_by_customer'
              ? 'requested_by_customer'
              : opts.input.reason === 'duplicate'
                ? 'duplicate'
                : opts.input.reason === 'fraudulent'
                  ? 'fraudulent'
                  : undefined,
          metadata: {
            offcon_admin_id: opts.adminId,
            offcon_reason: opts.input.reason,
            offcon_notes: (opts.input.notes ?? '').slice(0, 500),
            offcon_source_txn: originalTxn.id,
          },
        },
        { idempotencyKey: `refund:${originalTxn.id}:${requestedAmount}` },
      ),
    { description: 'create_refund' },
  );

  // Record the local refund txn
  const refundTxn = await recordTransaction({
    userId: originalTxn.user_id,
    invoiceId: originalTxn.invoice_id,
    subscriptionId: originalTxn.subscription_id,
    transactionType: 'refund',
    amountCents: -Math.abs(requestedAmount),
    currency: originalTxn.currency,
    providerTxnId: stripeRefund.id,
    paymentMethodId: originalTxn.payment_method_id,
    status: stripeRefund.status === 'succeeded' ? 'succeeded' : 'pending',
    idempotencyKey: `refund:${originalTxn.id}:${requestedAmount}`,
    completedAt: stripeRefund.status === 'succeeded' ? new Date() : null,
    description: `Refund: ${opts.input.reason}`,
    metadata: {
      source_transaction_id: originalTxn.id,
      admin_id: opts.adminId,
      reason: opts.input.reason,
      notes: opts.input.notes ?? '',
      stripe_refund_id: stripeRefund.id,
    },
  });

  log.info(
    {
      refund_txn_id: refundTxn.id,
      source_txn_id: originalTxn.id,
      amount_cents: requestedAmount,
      admin_id: opts.adminId,
      reason: opts.input.reason,
    },
    'refund_issued',
  );
  return refundTxn;
}

// Re-exported for transaction handlers that need explicit transactional refund recording
export { withTxn as withRefundTransaction };
