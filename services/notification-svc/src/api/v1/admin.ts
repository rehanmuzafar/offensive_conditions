/**
 * Admin endpoints: templates, broadcasts, deliveries.
 */

import { randomUUID } from 'node:crypto';

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { AppError, ErrorCode } from '@/config/errors.js';
import { query } from '@/db/pool.js';
import { compileMjml } from '@/services/templates.js';
import { dispatchEvent } from '@/services/dispatcher.js';
import {
  BroadcastSchema,
  TemplateCreateSchema,
  TemplateReadSchema,
  TemplateUpdateSchema,
  UuidSchema,
} from '@/schemas/index.js';
import type { DeliveryRow, TemplateRow } from '@/models/rows.js';

function templateToRead(row: TemplateRow): z.infer<typeof TemplateReadSchema> {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    event_type: row.event_type,
    channel: row.channel,
    locale: row.locale,
    subject: row.subject,
    body_source: row.body_source,
    body_compiled: row.body_compiled,
    variables: row.variables ?? [],
    is_active: row.is_active,
    version: row.version,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  // ===========================================================================
  // Templates
  // ===========================================================================

  app.get(
    '/v1/admin/templates',
    {
      preHandler: app.requireAdmin,
      schema: {
        querystring: z.object({
          event_type: z.string().optional(),
          channel: z.string().optional(),
          locale: z.string().optional(),
        }),
        response: { 200: z.object({ items: z.array(TemplateReadSchema) }) },
      },
    },
    async (request) => {
      const q = request.query as { event_type?: string; channel?: string; locale?: string };
      const conditions: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      if (q.event_type) {
        conditions.push(`event_type = $${idx++}`);
        values.push(q.event_type);
      }
      if (q.channel) {
        conditions.push(`channel = $${idx++}`);
        values.push(q.channel);
      }
      if (q.locale) {
        conditions.push(`locale = $${idx++}`);
        values.push(q.locale);
      }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const result = await query<TemplateRow>(
        `SELECT * FROM notification.templates ${where} ORDER BY event_type, channel, locale`,
        values,
      );
      return { items: result.rows.map(templateToRead) };
    },
  );

  app.post(
    '/v1/admin/templates',
    {
      preHandler: app.requireAdmin,
      schema: { body: TemplateCreateSchema, response: { 201: TemplateReadSchema } },
    },
    async (request: FastifyRequest, reply) => {
      const body = request.body as z.infer<typeof TemplateCreateSchema>;
      // Compile MJML at create time so the worker never pays the cost
      let bodyCompiled: string | null = null;
      if (body.channel === 'email') {
        try {
          bodyCompiled = compileMjml(body.body_source);
        } catch (err) {
          throw new AppError(
            ErrorCode.TEMPLATE_INVALID,
            `MJML compilation failed: ${(err as Error).message}`,
          );
        }
      }
      try {
        const result = await query<TemplateRow>(
          `
          INSERT INTO notification.templates (
            code, name, description, event_type, channel, locale,
            subject, body_source, body_compiled, variables, created_by
          )
          VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, $10::JSONB, $11
          )
          RETURNING *
          `,
          [
            body.code,
            body.name,
            body.description ?? null,
            body.event_type,
            body.channel,
            body.locale,
            body.subject ?? null,
            body.body_source,
            bodyCompiled,
            JSON.stringify(body.variables ?? []),
            request.claims!.user_id,
          ],
        );
        reply.code(201);
        return templateToRead(result.rows[0]!);
      } catch (err) {
        const pgCode = (err as { code?: string }).code;
        if (pgCode === '23505') {
          throw new AppError(
            ErrorCode.CONFLICT,
            'template with (event_type, channel, locale) or code already exists',
          );
        }
        throw err;
      }
    },
  );

  app.patch(
    '/v1/admin/templates/:id',
    {
      preHandler: app.requireAdmin,
      schema: {
        params: z.object({ id: UuidSchema }),
        body: TemplateUpdateSchema,
        response: { 200: TemplateReadSchema },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = request.body as z.infer<typeof TemplateUpdateSchema>;

      const existing = await query<TemplateRow>(
        `SELECT * FROM notification.templates WHERE id = $1`,
        [id],
      );
      if (existing.rows.length === 0) {
        throw new AppError(ErrorCode.TEMPLATE_NOT_FOUND, 'template not found');
      }

      // If body_source or channel changed and channel is email, recompile MJML
      let bodyCompiled: string | null | undefined;
      const targetChannel = body.channel ?? existing.rows[0]!.channel;
      const targetSource = body.body_source ?? existing.rows[0]!.body_source;
      if (
        targetChannel === 'email' &&
        (body.body_source !== undefined || body.channel !== undefined)
      ) {
        try {
          bodyCompiled = compileMjml(targetSource);
        } catch (err) {
          throw new AppError(
            ErrorCode.TEMPLATE_INVALID,
            `MJML compilation failed: ${(err as Error).message}`,
          );
        }
      }

      const sets: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      const fields = ['code', 'name', 'description', 'event_type', 'channel', 'locale', 'subject', 'body_source'] as const;
      for (const f of fields) {
        const v = body[f];
        if (v !== undefined) {
          sets.push(`${f} = $${idx++}`);
          values.push(v);
        }
      }
      if (body.variables !== undefined) {
        sets.push(`variables = $${idx++}::JSONB`);
        values.push(JSON.stringify(body.variables));
      }
      if (body.is_active !== undefined) {
        sets.push(`is_active = $${idx++}`);
        values.push(body.is_active);
      }
      if (bodyCompiled !== undefined) {
        sets.push(`body_compiled = $${idx++}`);
        values.push(bodyCompiled);
      }
      if (sets.length === 0) {
        return templateToRead(existing.rows[0]!);
      }
      sets.push(`version = version + 1`);
      sets.push(`updated_at = NOW()`);
      values.push(id);
      const result = await query<TemplateRow>(
        `UPDATE notification.templates SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
        values,
      );
      return templateToRead(result.rows[0]!);
    },
  );

  // ===========================================================================
  // Broadcast
  // ===========================================================================

  app.post(
    '/v1/admin/broadcast',
    {
      preHandler: app.requireAdmin,
      schema: { body: BroadcastSchema },
    },
    async (request: FastifyRequest, reply) => {
      const body = request.body as z.infer<typeof BroadcastSchema>;
      const target = body.target;
      if (!target.all_users && !target.tier && (!target.user_ids || target.user_ids.length === 0)) {
        throw new AppError(
          ErrorCode.BAD_REQUEST,
          'target must specify all_users, tier, or user_ids',
        );
      }

      // For all_users / tier-based, we'd query user-svc for the recipient list.
      // For now we support explicit user_ids and a placeholder for the others.
      let recipients: string[] = [];
      if (target.user_ids && target.user_ids.length > 0) {
        recipients = target.user_ids;
      } else if (target.all_users || target.tier) {
        // Production: gRPC to user-svc.ListUsers(tier=...) → page through. Stub.
        recipients = [];
      }

      const broadcastEventId = `broadcast_${randomUUID()}`;
      const dispatchedTo: string[] = [];
      for (const userId of recipients) {
        try {
          await dispatchEvent({
            user_id: userId,
            event_id: `${broadcastEventId}_${userId}`,
            event_type: body.event_type,
            channels: body.channels,
            priority: body.priority,
            variables: { title: body.title, body: body.body, action_url: body.action_url },
            title: body.title,
            body: body.body,
            action_url: body.action_url,
          });
          dispatchedTo.push(userId);
        } catch (err) {
          // Log but continue
          request.log.warn({ err, user_id: userId }, 'broadcast_dispatch_failed');
        }
      }

      reply.code(202);
      return {
        broadcast_event_id: broadcastEventId,
        recipient_count: recipients.length,
        dispatched_count: dispatchedTo.length,
      };
    },
  );

  // ===========================================================================
  // Deliveries (observability)
  // ===========================================================================

  app.get(
    '/v1/admin/deliveries',
    {
      preHandler: app.requireAdmin,
      schema: {
        querystring: z.object({
          user_id: UuidSchema.optional(),
          event_id: z.string().optional(),
          channel: z.string().optional(),
          status: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
          offset: z.coerce.number().int().min(0).default(0),
        }),
      },
    },
    async (request) => {
      const q = request.query as {
        user_id?: string;
        event_id?: string;
        channel?: string;
        status?: string;
        limit: number;
        offset: number;
      };
      const conditions: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      if (q.user_id) {
        conditions.push(`user_id = $${idx++}`);
        values.push(q.user_id);
      }
      if (q.event_id) {
        conditions.push(`event_id = $${idx++}`);
        values.push(q.event_id);
      }
      if (q.channel) {
        conditions.push(`channel = $${idx++}`);
        values.push(q.channel);
      }
      if (q.status) {
        conditions.push(`status = $${idx++}`);
        values.push(q.status);
      }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

      const countResult = await query<{ count: string }>(
        `SELECT COUNT(*)::TEXT AS count FROM notification.deliveries ${where}`,
        values,
      );
      const total = Number(countResult.rows[0]!.count);

      values.push(q.limit, q.offset);
      const result = await query<DeliveryRow>(
        `
        SELECT * FROM notification.deliveries
        ${where}
        ORDER BY created_at DESC
        LIMIT $${idx++} OFFSET $${idx}
        `,
        values,
      );
      return {
        items: result.rows,
        meta: {
          total,
          limit: q.limit,
          offset: q.offset,
          has_more: q.offset + q.limit < total,
        },
      };
    },
  );
}
