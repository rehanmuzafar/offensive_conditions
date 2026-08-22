/**
 * Webhook registration & management routes (user-owned outbound integrations).
 */

import { randomBytes } from 'node:crypto';

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { AppError, ErrorCode } from '@/config/errors.js';
import { validateWebhookUrl } from '@/channels/webhook.js';
import { query } from '@/db/pool.js';
import { dispatchEvent } from '@/services/dispatcher.js';
import {
  WebhookCreateSchema,
  WebhookReadSchema,
  WebhookUpdateSchema,
} from '@/schemas/index.js';
import type { WebhookRow } from '@/models/rows.js';

const MAX_WEBHOOKS_PER_USER = 10;

function rowToRead(row: WebhookRow): z.infer<typeof WebhookReadSchema> {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    event_types: row.event_types,
    is_active: row.is_active,
    failure_count: row.failure_count,
    last_success_at: row.last_success_at?.toISOString() ?? null,
    last_failure_at: row.last_failure_at?.toISOString() ?? null,
    last_failure_msg: row.last_failure_msg,
    disabled_at: row.disabled_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
  };
}

function generateSecret(): string {
  return `whsk_${randomBytes(32).toString('base64url')}`;
}

export async function registerWebhookRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/v1/me/webhooks',
    {
      preHandler: app.requireAuth,
      schema: { response: { 200: z.object({ items: z.array(WebhookReadSchema) }) } },
    },
    async (request: FastifyRequest) => {
      const result = await query<WebhookRow>(
        `SELECT * FROM notification.webhooks WHERE user_id = $1 ORDER BY created_at DESC`,
        [request.claims!.user_id],
      );
      return { items: result.rows.map(rowToRead) };
    },
  );

  app.post(
    '/v1/me/webhooks',
    {
      preHandler: app.requireAuth,
      schema: {
        body: WebhookCreateSchema,
        response: {
          201: WebhookReadSchema.extend({ secret: z.string() }),
        },
      },
    },
    async (request: FastifyRequest, reply) => {
      const body = request.body as z.infer<typeof WebhookCreateSchema>;
      validateWebhookUrl(body.url);

      const countResult = await query<{ count: string }>(
        `SELECT COUNT(*)::TEXT AS count FROM notification.webhooks WHERE user_id = $1`,
        [request.claims!.user_id],
      );
      if (Number(countResult.rows[0]!.count) >= MAX_WEBHOOKS_PER_USER) {
        throw new AppError(
          ErrorCode.WEBHOOK_LIMIT_REACHED,
          `max ${MAX_WEBHOOKS_PER_USER} webhooks per user`,
        );
      }

      const secret = generateSecret();
      const result = await query<WebhookRow>(
        `
        INSERT INTO notification.webhooks (user_id, name, url, secret, event_types)
        VALUES ($1, $2, $3, $4, $5::TEXT[])
        RETURNING *
        `,
        [request.claims!.user_id, body.name, body.url, secret, body.event_types],
      );
      reply.code(201);
      const row = result.rows[0]!;
      return { ...rowToRead(row), secret };
    },
  );

  app.patch(
    '/v1/me/webhooks/:id',
    {
      preHandler: app.requireAuth,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: WebhookUpdateSchema,
        response: { 200: WebhookReadSchema },
      },
    },
    async (request: FastifyRequest) => {
      const { id } = request.params as { id: string };
      const body = request.body as z.infer<typeof WebhookUpdateSchema>;
      if (body.url) validateWebhookUrl(body.url);

      const owned = await query<WebhookRow>(
        `SELECT * FROM notification.webhooks WHERE id = $1 AND user_id = $2`,
        [id, request.claims!.user_id],
      );
      if (owned.rows.length === 0) {
        throw new AppError(ErrorCode.WEBHOOK_NOT_FOUND, 'webhook not found');
      }

      const sets: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      if (body.name !== undefined) {
        sets.push(`name = $${idx++}`);
        values.push(body.name);
      }
      if (body.url !== undefined) {
        sets.push(`url = $${idx++}`);
        values.push(body.url);
      }
      if (body.event_types !== undefined) {
        sets.push(`event_types = $${idx++}::TEXT[]`);
        values.push(body.event_types);
      }
      if (body.is_active !== undefined) {
        sets.push(`is_active = $${idx++}`);
        values.push(body.is_active);
        if (body.is_active) {
          sets.push(`disabled_at = NULL`);
          sets.push(`failure_count = 0`);
        }
      }
      if (sets.length === 0) {
        return rowToRead(owned.rows[0]!);
      }
      sets.push(`updated_at = NOW()`);
      values.push(id);
      const result = await query<WebhookRow>(
        `UPDATE notification.webhooks SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
        values,
      );
      return rowToRead(result.rows[0]!);
    },
  );

  app.delete(
    '/v1/me/webhooks/:id',
    {
      preHandler: app.requireAuth,
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (request: FastifyRequest, reply) => {
      const { id } = request.params as { id: string };
      const result = await query(
        `DELETE FROM notification.webhooks WHERE id = $1 AND user_id = $2`,
        [id, request.claims!.user_id],
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new AppError(ErrorCode.WEBHOOK_NOT_FOUND, 'webhook not found');
      }
      reply.code(204);
    },
  );

  app.post(
    '/v1/me/webhooks/:id/rotate-secret',
    {
      preHandler: app.requireAuth,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ secret: z.string() }) },
      },
    },
    async (request: FastifyRequest) => {
      const { id } = request.params as { id: string };
      const secret = generateSecret();
      const result = await query<WebhookRow>(
        `
        UPDATE notification.webhooks
           SET secret = $1, updated_at = NOW()
         WHERE id = $2 AND user_id = $3
         RETURNING id
        `,
        [secret, id, request.claims!.user_id],
      );
      if (result.rowCount === 0) {
        throw new AppError(ErrorCode.WEBHOOK_NOT_FOUND, 'webhook not found');
      }
      return { secret };
    },
  );

  app.post(
    '/v1/me/webhooks/:id/test',
    {
      preHandler: app.requireAuth,
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (request: FastifyRequest) => {
      const { id } = request.params as { id: string };
      const owned = await query<WebhookRow>(
        `SELECT * FROM notification.webhooks WHERE id = $1 AND user_id = $2`,
        [id, request.claims!.user_id],
      );
      if (owned.rows.length === 0) {
        throw new AppError(ErrorCode.WEBHOOK_NOT_FOUND, 'webhook not found');
      }
      // Synthetic event via dispatcher (event_id forced so it's unique each test)
      const outcome = await dispatchEvent({
        user_id: request.claims!.user_id,
        event_id: `test_${id}_${Date.now()}`,
        event_type: 'system.webhook_test',
        channels: ['webhook'],
        variables: {
          message: 'This is a test event from Offense Conditions.',
          test: true,
        },
      });
      return { delivery_ids: outcome.delivery_ids };
    },
  );
}
