/**
 * User-facing notification routes.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { AppError, ErrorCode } from '@/config/errors.js';
import { query } from '@/db/pool.js';
import {
  MarkReadSchema,
  NotificationListQuery,
  NotificationReadSchema,
  PageMetaSchema,
  PreferencesBulkUpdate,
} from '@/schemas/index.js';
import type { NotificationRow, PreferenceRow, UserSettingsRow } from '@/models/rows.js';

function rowToRead(row: NotificationRow): z.infer<typeof NotificationReadSchema> {
  return {
    id: row.id,
    event_type: row.event_type,
    priority: row.priority,
    title: row.title,
    body: row.body,
    action_url: row.action_url,
    icon: row.icon,
    metadata: row.metadata ?? {},
    read_at: row.read_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
  };
}

export async function registerMeRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/v1/me/notifications',
    {
      preHandler: app.requireAuth,
      schema: {
        querystring: NotificationListQuery,
        response: {
          200: z.object({
            items: z.array(NotificationReadSchema),
            meta: PageMetaSchema,
          }),
        },
      },
    },
    async (request: FastifyRequest) => {
      const claims = request.claims!;
      const q = request.query as z.infer<typeof NotificationListQuery>;
      const cursorTs = q.cursor ? new Date(q.cursor) : null;

      const conditions: string[] = ['user_id = $1', 'deleted_at IS NULL'];
      const values: unknown[] = [claims.user_id];
      if (q.unread_only) conditions.push('read_at IS NULL');
      if (cursorTs) {
        conditions.push(`created_at < $${values.length + 1}`);
        values.push(cursorTs);
      }
      values.push(q.limit + 1);
      const result = await query<NotificationRow>(
        `
        SELECT * FROM notification.notifications
        WHERE ${conditions.join(' AND ')}
        ORDER BY created_at DESC
        LIMIT $${values.length}
        `,
        values,
      );
      const items = result.rows.slice(0, q.limit);
      const hasMore = result.rows.length > q.limit;
      const lastItem = items.at(-1);
      return {
        items: items.map(rowToRead),
        meta: {
          next_cursor: hasMore && lastItem ? lastItem.created_at.toISOString() : null,
          has_more: hasMore,
        },
      };
    },
  );

  app.get(
    '/v1/me/notifications/unread-count',
    {
      preHandler: app.requireAuth,
      schema: { response: { 200: z.object({ count: z.number().int() }) } },
    },
    async (request: FastifyRequest) => {
      const result = await query<{ count: string }>(
        `
        SELECT COUNT(*)::TEXT AS count
        FROM notification.notifications
        WHERE user_id = $1 AND read_at IS NULL AND deleted_at IS NULL
        `,
        [request.claims!.user_id],
      );
      return { count: Number(result.rows[0]!.count) };
    },
  );

  app.post(
    '/v1/me/notifications/mark-read',
    {
      preHandler: app.requireAuth,
      schema: {
        body: MarkReadSchema,
        response: { 200: z.object({ marked: z.number().int() }) },
      },
    },
    async (request: FastifyRequest) => {
      const body = request.body as z.infer<typeof MarkReadSchema>;
      if (body.all) {
        const result = await query(
          `
          UPDATE notification.notifications
             SET read_at = NOW()
           WHERE user_id = $1 AND read_at IS NULL AND deleted_at IS NULL
          `,
          [request.claims!.user_id],
        );
        return { marked: result.rowCount ?? 0 };
      }
      if (!body.ids || body.ids.length === 0) {
        return { marked: 0 };
      }
      const result = await query(
        `
        UPDATE notification.notifications
           SET read_at = NOW()
         WHERE user_id = $1
           AND read_at IS NULL
           AND deleted_at IS NULL
           AND id = ANY($2::UUID[])
        `,
        [request.claims!.user_id, body.ids],
      );
      return { marked: result.rowCount ?? 0 };
    },
  );

  app.delete(
    '/v1/me/notifications/:id',
    {
      preHandler: app.requireAuth,
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (request: FastifyRequest, reply) => {
      const { id } = request.params as { id: string };
      const result = await query(
        `
        UPDATE notification.notifications
           SET deleted_at = NOW()
         WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
        `,
        [id, request.claims!.user_id],
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new AppError(ErrorCode.NOTIFICATION_NOT_FOUND, 'notification not found');
      }
      reply.code(204);
    },
  );

  // ===========================================================================
  // Preferences
  // ===========================================================================

  app.get(
    '/v1/me/preferences',
    { preHandler: app.requireAuth },
    async (request: FastifyRequest) => {
      const prefs = await query<PreferenceRow>(
        `SELECT * FROM notification.preferences WHERE user_id = $1 ORDER BY event_type`,
        [request.claims!.user_id],
      );
      const settings = await query<UserSettingsRow>(
        `SELECT * FROM notification.user_settings WHERE user_id = $1`,
        [request.claims!.user_id],
      );
      return {
        preferences: prefs.rows,
        settings: settings.rows[0] ?? null,
      };
    },
  );

  app.put(
    '/v1/me/preferences',
    {
      preHandler: app.requireAuth,
      schema: { body: PreferencesBulkUpdate },
    },
    async (request: FastifyRequest) => {
      const body = request.body as z.infer<typeof PreferencesBulkUpdate>;
      const userId = request.claims!.user_id;

      // Upsert each preference row
      for (const pref of body.preferences) {
        await query(
          `
          INSERT INTO notification.preferences (
            user_id, event_type,
            email_enabled, in_app_enabled, push_enabled, sms_enabled,
            digest_enabled, digest_frequency
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (user_id, event_type) DO UPDATE
            SET email_enabled = EXCLUDED.email_enabled,
                in_app_enabled = EXCLUDED.in_app_enabled,
                push_enabled = EXCLUDED.push_enabled,
                sms_enabled = EXCLUDED.sms_enabled,
                digest_enabled = EXCLUDED.digest_enabled,
                digest_frequency = EXCLUDED.digest_frequency,
                updated_at = NOW()
          `,
          [
            userId,
            pref.event_type,
            pref.email_enabled,
            pref.in_app_enabled,
            pref.push_enabled,
            pref.sms_enabled,
            pref.digest_enabled,
            pref.digest_frequency,
          ],
        );
      }

      // Settings (timezone, quiet hours, unsubscribe)
      if (
        body.master_unsubscribe !== undefined ||
        body.timezone !== undefined ||
        body.quiet_hours_start !== undefined ||
        body.quiet_hours_end !== undefined ||
        body.respect_quiet !== undefined
      ) {
        await query(
          `
          INSERT INTO notification.user_settings (
            user_id, timezone, quiet_hours_start, quiet_hours_end, respect_quiet, master_unsubscribe
          )
          VALUES ($1, COALESCE($2, 'UTC'), COALESCE($3, 22), COALESCE($4, 7), COALESCE($5, TRUE), COALESCE($6, FALSE))
          ON CONFLICT (user_id) DO UPDATE
            SET timezone = COALESCE(EXCLUDED.timezone, notification.user_settings.timezone),
                quiet_hours_start = COALESCE(EXCLUDED.quiet_hours_start, notification.user_settings.quiet_hours_start),
                quiet_hours_end = COALESCE(EXCLUDED.quiet_hours_end, notification.user_settings.quiet_hours_end),
                respect_quiet = COALESCE(EXCLUDED.respect_quiet, notification.user_settings.respect_quiet),
                master_unsubscribe = COALESCE(EXCLUDED.master_unsubscribe, notification.user_settings.master_unsubscribe),
                updated_at = NOW()
          `,
          [
            userId,
            body.timezone ?? null,
            body.quiet_hours_start ?? null,
            body.quiet_hours_end ?? null,
            body.respect_quiet ?? null,
            body.master_unsubscribe ?? null,
          ],
        );
      }
      return { ok: true };
    },
  );
}
