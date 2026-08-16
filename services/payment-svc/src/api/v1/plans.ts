/**
 * Plan + checkout HTTP routes.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { AppError, ErrorCode } from '@/config/errors.js';
import {
  CheckoutSessionCreateSchema,
  PlanReadSchema,
  PortalSessionCreateSchema,
  PortalSessionResponseSchema,
  CheckoutSessionResponseSchema,
} from '@/schemas/index.js';
import { createCheckoutSession, createPortalSession } from '@/services/checkout.js';
import { getPlanByCode, listPlans, planRowToRead } from '@/services/plans.js';

export async function registerPlanRoutes(app: FastifyInstance): Promise<void> {
  // Public listing of plans
  app.get(
    '/v1/plans',
    {
      schema: {
        querystring: z.object({
          region: z.string().length(2).optional(),
        }),
        response: { 200: z.object({ items: z.array(PlanReadSchema) }) },
      },
    },
    async (request) => {
      const { region } = request.query as { region?: string };
      const items = await listPlans({ region });
      return { items };
    },
  );

  app.get(
    '/v1/plans/:code',
    {
      schema: {
        params: z.object({ code: z.string() }),
        querystring: z.object({ region: z.string().length(2).optional() }),
        response: { 200: PlanReadSchema },
      },
    },
    async (request) => {
      const { code } = request.params as { code: string };
      const { region } = request.query as { region?: string };
      const plan = await getPlanByCode(code);
      if (!plan.is_active) {
        throw new AppError(ErrorCode.PLAN_INACTIVE, 'plan is not currently sold');
      }
      return planRowToRead(plan, region);
    },
  );

  // Authenticated checkout session creation
  app.post(
    '/v1/checkout/session',
    {
      preHandler: app.requireAuth,
      schema: {
        body: CheckoutSessionCreateSchema,
        response: { 200: CheckoutSessionResponseSchema },
      },
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (request: FastifyRequest) => {
      const claims = request.claims!;
      const body = request.body as z.infer<typeof CheckoutSessionCreateSchema>;
      // Email + region would come from user-svc lookup in production; we
      // accept them via JWT claims when present (auth-svc enriches the token).
      const email = (claims as unknown as { email?: string }).email ?? `${claims.user_id}@offensiveconditions.org`;
      const region = (claims as unknown as { region?: string }).region;

      const result = await createCheckoutSession({
        userId: claims.user_id,
        userEmail: email,
        regionCode: region,
        input: body,
      });
      return result;
    },
  );

  app.post(
    '/v1/portal/session',
    {
      preHandler: app.requireAuth,
      schema: {
        body: PortalSessionCreateSchema,
        response: { 200: PortalSessionResponseSchema },
      },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request: FastifyRequest) => {
      const claims = request.claims!;
      const body = request.body as z.infer<typeof PortalSessionCreateSchema>;
      const result = await createPortalSession({
        userId: claims.user_id,
        returnUrl: body.return_url,
      });
      return result;
    },
  );
}
