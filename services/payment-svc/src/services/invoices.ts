/**
 * Invoice service: mirror Stripe invoices, list for users.
 */

import { AppError, ErrorCode } from '@/config/errors.js';
import { getLogger } from '@/config/logger.js';
import { query } from '@/db/pool.js';
import type { InvoiceRow, InvoiceStatus } from '@/models/rows.js';

const log = getLogger('invoices');

export async function getInvoiceById(id: string): Promise<InvoiceRow> {
  const result = await query<InvoiceRow>(
    `SELECT * FROM payment.invoices WHERE id = $1`,
    [id],
  );
  if (result.rows.length === 0) {
    throw new AppError(ErrorCode.INVOICE_NOT_FOUND, 'invoice not found');
  }
  return result.rows[0]!;
}

export async function getInvoiceByProviderId(
  providerInvoiceId: string,
): Promise<InvoiceRow | null> {
  const result = await query<InvoiceRow>(
    `SELECT * FROM payment.invoices WHERE provider_invoice_id = $1`,
    [providerInvoiceId],
  );
  return result.rows[0] ?? null;
}

export async function listInvoicesForUser(opts: {
  userId: string;
  status?: InvoiceStatus;
  limit: number;
  offset: number;
}): Promise<{ items: InvoiceRow[]; total: number }> {
  const conditions: string[] = ['user_id = $1'];
  const values: unknown[] = [opts.userId];
  if (opts.status) {
    conditions.push(`status = $${values.length + 1}`);
    values.push(opts.status);
  }
  const where = `WHERE ${conditions.join(' AND ')}`;

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*)::TEXT AS count FROM payment.invoices ${where}`,
    values,
  );
  const total = Number(countResult.rows[0]!.count);

  values.push(opts.limit, opts.offset);
  const result = await query<InvoiceRow>(
    `
    SELECT * FROM payment.invoices
    ${where}
    ORDER BY created_at DESC
    LIMIT $${values.length - 1} OFFSET $${values.length}
    `,
    values,
  );
  return { items: result.rows, total };
}

/**
 * Insert or update an invoice from a Stripe invoice object.
 * Called by `invoice.{created,updated,paid,payment_failed,voided}` webhooks.
 */
export async function upsertFromStripe(opts: {
  userId: string;
  subscriptionId: string | null;
  customerId: string | null;
  number: string | null;
  providerInvoiceId: string;
  status: InvoiceStatus;
  amountDueCents: number;
  amountPaidCents: number;
  amountRemainingCents: number;
  subtotalCents: number;
  taxCents: number;
  discountCents: number;
  totalCents: number;
  currency: string;
  periodStart: Date | null;
  periodEnd: Date | null;
  dueAt: Date | null;
  paidAt: Date | null;
  voidedAt: Date | null;
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
  metadata: Record<string, unknown>;
}): Promise<InvoiceRow> {
  const existing = await getInvoiceByProviderId(opts.providerInvoiceId);
  if (existing) {
    const result = await query<InvoiceRow>(
      `
      UPDATE payment.invoices
         SET status = $1,
             amount_due_cents = $2,
             amount_paid_cents = $3,
             amount_remaining_cents = $4,
             subtotal_cents = $5,
             tax_cents = $6,
             discount_cents = $7,
             total_cents = $8,
             paid_at = $9,
             voided_at = $10,
             hosted_invoice_url = $11,
             invoice_pdf_url = $12,
             metadata = $13::JSONB,
             updated_at = NOW()
       WHERE id = $14
       RETURNING *
      `,
      [
        opts.status,
        opts.amountDueCents,
        opts.amountPaidCents,
        opts.amountRemainingCents,
        opts.subtotalCents,
        opts.taxCents,
        opts.discountCents,
        opts.totalCents,
        opts.paidAt,
        opts.voidedAt,
        opts.hostedInvoiceUrl,
        opts.invoicePdfUrl,
        JSON.stringify(opts.metadata),
        existing.id,
      ],
    );
    log.info(
      { invoice_id: existing.id, status: opts.status, paid_at: opts.paidAt },
      'invoice_updated',
    );
    return result.rows[0]!;
  }

  const result = await query<InvoiceRow>(
    `
    INSERT INTO payment.invoices (
      user_id, subscription_id, customer_id, number, provider,
      provider_invoice_id, status,
      amount_due_cents, amount_paid_cents, amount_remaining_cents,
      subtotal_cents, tax_cents, discount_cents, total_cents,
      currency, period_start, period_end, due_at, paid_at, voided_at,
      hosted_invoice_url, invoice_pdf_url, metadata
    )
    VALUES (
      $1, $2, $3, $4, 'stripe',
      $5, $6,
      $7, $8, $9,
      $10, $11, $12, $13,
      $14, $15, $16, $17, $18, $19,
      $20, $21, $22::JSONB
    )
    RETURNING *
    `,
    [
      opts.userId,
      opts.subscriptionId,
      opts.customerId,
      opts.number,
      opts.providerInvoiceId,
      opts.status,
      opts.amountDueCents,
      opts.amountPaidCents,
      opts.amountRemainingCents,
      opts.subtotalCents,
      opts.taxCents,
      opts.discountCents,
      opts.totalCents,
      opts.currency,
      opts.periodStart,
      opts.periodEnd,
      opts.dueAt,
      opts.paidAt,
      opts.voidedAt,
      opts.hostedInvoiceUrl,
      opts.invoicePdfUrl,
      JSON.stringify(opts.metadata),
    ],
  );
  log.info(
    {
      invoice_id: result.rows[0]!.id,
      number: opts.number,
      total_cents: opts.totalCents,
    },
    'invoice_created',
  );
  return result.rows[0]!;
}
