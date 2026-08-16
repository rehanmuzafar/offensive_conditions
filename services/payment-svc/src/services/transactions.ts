/**
 * Transaction service: ledger row recording for every $ movement.
 *
 * `payment.transactions` is partitioned by month (Phase 2 schema), so inserts
 * route automatically. Each row represents one accounting event — charge,
 * refund, adjustment, chargeback, or payout. The sign of `amount_cents` is
 * positive for money received (charges) and negative for money sent out
 * (refunds, payouts).
 */

import { AppError, ErrorCode } from '@/config/errors.js';
import { getLogger } from '@/config/logger.js';
import { query } from '@/db/pool.js';
import type {
  RiskLevel,
  TransactionRow,
  TransactionStatus,
  TransactionType,
} from '@/models/rows.js';

const log = getLogger('transactions');


export async function recordTransaction(opts: {
  userId: string;
  invoiceId?: string | null;
  subscriptionId?: string | null;
  transactionType: TransactionType;
  amountCents: number;
  currency: string;
  feeCents?: number;
  providerTxnId?: string | null;
  paymentMethodId?: string | null;
  status: TransactionStatus;
  failureCode?: string | null;
  failureMessage?: string | null;
  riskScore?: number | null;
  riskLevel?: RiskLevel | null;
  idempotencyKey?: string | null;
  completedAt?: Date | null;
  description?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<TransactionRow> {
  const fee = opts.feeCents ?? 0;
  const net = opts.amountCents - fee;

  try {
    const result = await query<TransactionRow>(
      `
      INSERT INTO payment.transactions (
        user_id, invoice_id, subscription_id,
        transaction_type, amount_cents, currency, fee_cents, net_cents,
        provider, provider_txn_id, payment_method_id,
        status, failure_code, failure_message,
        risk_score, risk_level, idempotency_key,
        initiated_at, completed_at, description, metadata
      )
      VALUES (
        $1, $2, $3,
        $4, $5, $6, $7, $8,
        'stripe', $9, $10,
        $11, $12, $13,
        $14, $15, $16,
        NOW(), $17, $18, $19::JSONB
      )
      RETURNING *
      `,
      [
        opts.userId,
        opts.invoiceId ?? null,
        opts.subscriptionId ?? null,
        opts.transactionType,
        opts.amountCents,
        opts.currency,
        fee,
        net,
        opts.providerTxnId ?? null,
        opts.paymentMethodId ?? null,
        opts.status,
        opts.failureCode ?? null,
        opts.failureMessage ?? null,
        opts.riskScore ?? null,
        opts.riskLevel ?? null,
        opts.idempotencyKey ?? null,
        opts.completedAt ?? null,
        opts.description ?? null,
        JSON.stringify(opts.metadata ?? {}),
      ],
    );
    log.info(
      {
        transaction_id: result.rows[0]!.id,
        user_id: opts.userId,
        type: opts.transactionType,
        amount_cents: opts.amountCents,
        status: opts.status,
      },
      'transaction_recorded',
    );
    return result.rows[0]!;
  } catch (err) {
    const pgCode = (err as { code?: string }).code;
    if (pgCode === '23505' && opts.idempotencyKey) {
      // Idempotent re-submission — look up the existing row and return it
      const existing = await query<TransactionRow>(
        `SELECT * FROM payment.transactions WHERE idempotency_key = $1 LIMIT 1`,
        [opts.idempotencyKey],
      );
      if (existing.rows.length > 0) {
        log.info({ idempotency_key: opts.idempotencyKey }, 'transaction_idempotent_hit');
        return existing.rows[0]!;
      }
    }
    throw err;
  }
}

export async function getTransactionById(id: string): Promise<TransactionRow> {
  const result = await query<TransactionRow>(
    `SELECT * FROM payment.transactions WHERE id = $1`,
    [id],
  );
  if (result.rows.length === 0) {
    throw new AppError(ErrorCode.NOT_FOUND, 'transaction not found');
  }
  return result.rows[0]!;
}

export async function getTransactionByProviderId(
  providerTxnId: string,
): Promise<TransactionRow | null> {
  const result = await query<TransactionRow>(
    `SELECT * FROM payment.transactions WHERE provider_txn_id = $1 LIMIT 1`,
    [providerTxnId],
  );
  return result.rows[0] ?? null;
}

export async function searchTransactions(opts: {
  userId?: string;
  providerTxnId?: string;
  status?: string;
  type?: string;
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
}): Promise<{ items: TransactionRow[]; total: number }> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  if (opts.userId) {
    conditions.push(`user_id = $${idx++}`);
    values.push(opts.userId);
  }
  if (opts.providerTxnId) {
    conditions.push(`provider_txn_id = $${idx++}`);
    values.push(opts.providerTxnId);
  }
  if (opts.status) {
    conditions.push(`status = $${idx++}`);
    values.push(opts.status);
  }
  if (opts.type) {
    conditions.push(`transaction_type = $${idx++}`);
    values.push(opts.type);
  }
  if (opts.from) {
    conditions.push(`initiated_at >= $${idx++}`);
    values.push(opts.from);
  }
  if (opts.to) {
    conditions.push(`initiated_at <= $${idx++}`);
    values.push(opts.to);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*)::TEXT AS count FROM payment.transactions ${where}`,
    values,
  );
  const total = Number(countResult.rows[0]!.count);

  values.push(opts.limit, opts.offset);
  const result = await query<TransactionRow>(
    `
    SELECT * FROM payment.transactions
    ${where}
    ORDER BY initiated_at DESC
    LIMIT $${idx++} OFFSET $${idx}
    `,
    values,
  );
  return { items: result.rows, total };
}

/**
 * Sum charges minus refunds for a user — the lifetime value (LTV).
 * Used by support tooling and rate-limit decisions for refunds.
 */
export async function getUserLifetimeRevenue(userId: string): Promise<{
  total_charges_cents: number;
  total_refunds_cents: number;
  net_cents: number;
  currency: string;
}> {
  const result = await query<{
    total_charges_cents: string;
    total_refunds_cents: string;
    currency: string | null;
  }>(
    `
    SELECT
      COALESCE(SUM(amount_cents) FILTER (
        WHERE transaction_type = 'charge' AND status = 'succeeded'
      ), 0)::TEXT AS total_charges_cents,
      COALESCE(SUM(amount_cents) FILTER (
        WHERE transaction_type = 'refund' AND status = 'succeeded'
      ), 0)::TEXT AS total_refunds_cents,
      (SELECT currency FROM payment.transactions WHERE user_id = $1 LIMIT 1) AS currency
    FROM payment.transactions
    WHERE user_id = $1
    `,
    [userId],
  );
  const row = result.rows[0]!;
  const charges = Number(row.total_charges_cents);
  const refunds = Number(row.total_refunds_cents);
  return {
    total_charges_cents: charges,
    total_refunds_cents: Math.abs(refunds),
    net_cents: charges - Math.abs(refunds),
    currency: row.currency ?? 'USD',
  };
}
