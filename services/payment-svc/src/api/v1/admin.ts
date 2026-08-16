/**
 * Admin endpoints: plan + coupon management, refunds, transaction search.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  CouponCreateSchema,
  PlanCreateSchema,
  PlanReadSchema,
  PlanUpdateSchema,
  RefundCreateSchema,
  TransactionSearchSchema,
  UuidSchema,
} from '@/schemas/index.js';
import { createCoupon } from '@/services/coupons.js';
import { createPlan, listPlans, planRowToRead, updatePlan } from '@/services/plans.js';
import { immediateCancelByAdmin } from '@/services/subscriptions.js';
import { issueRefund } from '@/services/refunds.js';
import { searchTransactions, getUserLifetimeRevenue } from '@/services/transactions.js';

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  // -------------------- Plans --------------------

  app.get(
    '/v1/admin/plans',
    {
      preHandler: app.requireAdmin,
      schema: {
        querystring: z.object({
          include_inactive: z.coerce.boolean().default(false),
          include_legacy: z.coerce.boolean().default(false),
        }),
        response: { 200: z.object({ items: z.array(PlanReadSchema) }) },
      },
    },
    async (request) => {
      const { include_inactive, include_legacy } = request.query as {
        include_inactive: boolean;
        include_legacy: boolean;
      };
      const items = await listPlans({ includeInactive: include_inactive, includeLegacy: include_legacy });
      return { items };
    },
  );

  app.post(
    '/v1/admin/plans',
    {
      preHandler: app.requireAdmin,
      schema: { body: PlanCreateSchema, response: { 201: PlanReadSchema } },
    },
    async (request, reply) => {
      const body = request.body as z.infer<typeof PlanCreateSchema>;
      const plan = await createPlan({
        code: body.code,
        name: body.name,
        description: body.description ?? null,
        tier: body.tier,
        billing_cycle: body.billing_cycle,
        base_price_cents: body.base_price_cents,
        currency: body.currency,
        regional_pricing: body.regional_pricing,
        stripe_product_id: body.stripe_product_id ?? null,
        stripe_price_id: body.stripe_price_id ?? null,
        features: body.features,
        max_concurrent_instances: body.max_concurrent_instances,
        max_daily_spawns: body.max_daily_spawns,
      });
      reply.code(201);
      return planRowToRead(plan);
    },
  );

  app.patch(
    '/v1/admin/plans/:id',
    {
      preHandler: app.requireAdmin,
      schema: {
        params: z.object({ id: UuidSchema }),
        body: PlanUpdateSchema,
        response: { 200: PlanReadSchema },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = request.body as z.infer<typeof PlanUpdateSchema>;
      const updated = await updatePlan(id, body);
      return planRowToRead(updated);
    },
  );

  // -------------------- Subscriptions --------------------

  app.post(
    '/v1/admin/subscriptions/:id/cancel',
    {
      preHandler: app.requireAdmin,
      schema: {
        params: z.object({ id: UuidSchema }),
        body: z.object({ reason: z.string().min(1).max(2000) }),
      },
    },
    async (request: FastifyRequest) => {
      const { id } = request.params as { id: string };
      const { reason } = request.body as { reason: string };
      const sub = await immediateCancelByAdmin({
        subscriptionId: id,
        adminId: request.claims!.user_id,
        reason,
      });
      return { id: sub.id, status: sub.status, canceled_at: sub.canceled_at?.toISOString() };
    },
  );

  // -------------------- Refunds --------------------

  app.post(
    '/v1/admin/refunds',
    {
      preHandler: app.requireAdmin,
      schema: { body: RefundCreateSchema },
    },
    async (request: FastifyRequest, reply) => {
      const body = request.body as z.infer<typeof RefundCreateSchema>;
      const txn = await issueRefund({
        adminId: request.claims!.user_id,
        input: body,
      });
      reply.code(201);
      return {
        id: txn.id,
        amount_cents: txn.amount_cents,
        status: txn.status,
        provider_txn_id: txn.provider_txn_id,
      };
    },
  );

  // -------------------- Transactions --------------------

  app.get(
    '/v1/admin/transactions',
    {
      preHandler: app.requireAdmin,
      schema: { querystring: TransactionSearchSchema },
    },
    async (request) => {
      const q = request.query as z.infer<typeof TransactionSearchSchema>;
      const { items, total } = await searchTransactions({
        userId: q.user_id,
        providerTxnId: q.provider_txn_id,
        status: q.status,
        type: q.type,
        from: q.from ? new Date(q.from) : undefined,
        to: q.to ? new Date(q.to) : undefined,
        limit: q.limit,
        offset: q.offset,
      });
      return {
        items,
        meta: {
          total,
          limit: q.limit,
          offset: q.offset,
          has_more: q.offset + q.limit < total,
        },
      };
    },
  );

  app.get(
    '/v1/admin/users/:userId/revenue',
    {
      preHandler: app.requireAdmin,
      schema: { params: z.object({ userId: UuidSchema }) },
    },
    async (request) => {
      const { userId } = request.params as { userId: string };
      return getUserLifetimeRevenue(userId);
    },
  );

  // -------------------- Coupons --------------------

  app.post(
    '/v1/admin/coupons',
    {
      preHandler: app.requireAdmin,
      schema: { body: CouponCreateSchema },
    },
    async (request, reply) => {
      const body = request.body as z.infer<typeof CouponCreateSchema>;
      const coupon = await createCoupon({
        code: body.code,
        name: body.name,
        description: body.description ?? null,
        discount_type: body.discount_type,
        discount_value: body.discount_value,
        currency: body.currency ?? null,
        duration: body.duration,
        duration_in_months: body.duration_in_months ?? null,
        max_redemptions: body.max_redemptions ?? null,
        max_redemptions_per_user: body.max_redemptions_per_user,
        applies_to_plans: body.applies_to_plans ?? null,
        valid_until: body.valid_until ? new Date(body.valid_until) : null,
      });
      reply.code(201);
      return {
        id: coupon.id,
        code: coupon.code,
        name: coupon.name,
        discount_type: coupon.discount_type,
        discount_value: coupon.discount_value,
        duration: coupon.duration,
        valid_until: coupon.valid_until?.toISOString() ?? null,
      };
    },
  );
}
