/**
 * User-facing subscription / invoice / coupon routes.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  CouponRedeemSchema,
  CouponValidationSchema,
  InvoiceReadSchema,
  SubscriptionCancelSchema,
  SubscriptionReadSchema,
} from '@/schemas/index.js';
import { cancelAtPeriodEnd, getActiveSubscriptionForUser, resumeSubscription } from '@/services/subscriptions.js';
import { getInvoiceById, listInvoicesForUser } from '@/services/invoices.js';
import { validateCoupon } from '@/services/coupons.js';
import { AppError, ErrorCode } from '@/config/errors.js';
import type { InvoiceRow, InvoiceStatus, SubscriptionRow, PlanRow } from '@/models/rows.js';

function subscriptionToRead(sub: SubscriptionRow, plan: PlanRow): z.infer<typeof SubscriptionReadSchema> {
  return {
    id: sub.id,
    user_id: sub.user_id,
    plan_id: sub.plan_id,
    plan_code: plan.code,
    provider: sub.provider,
    status: sub.status,
    trial_start_at: sub.trial_start_at?.toISOString() ?? null,
    trial_end_at: sub.trial_end_at?.toISOString() ?? null,
    current_period_start: sub.current_period_start.toISOString(),
    current_period_end: sub.current_period_end.toISOString(),
    cancel_at_period_end: sub.cancel_at_period_end,
    canceled_at: sub.canceled_at?.toISOString() ?? null,
    cancellation_reason: sub.cancellation_reason,
    ended_at: sub.ended_at?.toISOString() ?? null,
    price_cents_at_signup: sub.price_cents_at_signup,
    currency_at_signup: sub.currency_at_signup,
  };
}

function invoiceToRead(row: InvoiceRow): z.infer<typeof InvoiceReadSchema> {
  return {
    id: row.id,
    user_id: row.user_id,
    subscription_id: row.subscription_id,
    number: row.number,
    status: row.status,
    amount_due_cents: row.amount_due_cents,
    amount_paid_cents: row.amount_paid_cents,
    total_cents: row.total_cents,
    currency: row.currency,
    period_start: row.period_start?.toISOString() ?? null,
    period_end: row.period_end?.toISOString() ?? null,
    due_at: row.due_at?.toISOString() ?? null,
    paid_at: row.paid_at?.toISOString() ?? null,
    hosted_invoice_url: row.hosted_invoice_url,
    invoice_pdf_url: row.invoice_pdf_url,
    created_at: row.created_at.toISOString(),
  };
}

export async function registerMeRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/v1/me/subscription',
    {
      preHandler: app.requireAuth,
      schema: { response: { 200: SubscriptionReadSchema.nullable() } },
    },
    async (request: FastifyRequest) => {
      const active = await getActiveSubscriptionForUser(request.claims!.user_id);
      if (!active) return null;
      return subscriptionToRead(active.subscription, active.plan);
    },
  );

  app.post(
    '/v1/me/subscription/cancel',
    {
      preHandler: app.requireAuth,
      schema: {
        body: SubscriptionCancelSchema,
        response: { 200: SubscriptionReadSchema },
      },
    },
    async (request: FastifyRequest) => {
      const body = request.body as z.infer<typeof SubscriptionCancelSchema>;
      const sub = await cancelAtPeriodEnd({
        userId: request.claims!.user_id,
        cancellationReason: body.cancellation_reason,
      });
      const active = await getActiveSubscriptionForUser(request.claims!.user_id);
      // After cancel-at-period-end, the active sub is still the same row
      if (!active) {
        throw new AppError(ErrorCode.INTERNAL, 'subscription disappeared after cancel');
      }
      return subscriptionToRead(sub, active.plan);
    },
  );

  app.post(
    '/v1/me/subscription/resume',
    {
      preHandler: app.requireAuth,
      schema: { response: { 200: SubscriptionReadSchema } },
    },
    async (request: FastifyRequest) => {
      const sub = await resumeSubscription(request.claims!.user_id);
      const active = await getActiveSubscriptionForUser(request.claims!.user_id);
      if (!active) {
        throw new AppError(ErrorCode.INTERNAL, 'subscription disappeared after resume');
      }
      return subscriptionToRead(sub, active.plan);
    },
  );

  app.get(
    '/v1/me/invoices',
    {
      preHandler: app.requireAuth,
      schema: {
        querystring: z.object({
          status: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(25),
          offset: z.coerce.number().int().min(0).default(0),
        }),
        response: {
          200: z.object({
            items: z.array(InvoiceReadSchema),
            meta: z.object({
              total: z.number(),
              limit: z.number(),
              offset: z.number(),
              has_more: z.boolean(),
            }),
          }),
        },
      },
    },
    async (request: FastifyRequest) => {
      const { status, limit, offset } = request.query as {
        status?: InvoiceStatus;
        limit: number;
        offset: number;
      };
      const { items, total } = await listInvoicesForUser({
        userId: request.claims!.user_id,
        status,
        limit,
        offset,
      });
      return {
        items: items.map(invoiceToRead),
        meta: {
          total,
          limit,
          offset,
          has_more: offset + limit < total,
        },
      };
    },
  );

  app.get(
    '/v1/me/invoices/:id',
    {
      preHandler: app.requireAuth,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: InvoiceReadSchema },
      },
    },
    async (request: FastifyRequest) => {
      const { id } = request.params as { id: string };
      const invoice = await getInvoiceById(id);
      if (invoice.user_id !== request.claims!.user_id && !request.claims!.is_admin) {
        throw new AppError(ErrorCode.NOT_FOUND, 'invoice not found');
      }
      return invoiceToRead(invoice);
    },
  );

  app.post(
    '/v1/coupons/redeem',
    {
      preHandler: app.requireAuth,
      schema: {
        body: CouponRedeemSchema,
        response: { 200: CouponValidationSchema },
      },
    },
    async (request: FastifyRequest) => {
      const body = request.body as z.infer<typeof CouponRedeemSchema>;
      return validateCoupon(body.code, body.plan_code);
    },
  );
}
