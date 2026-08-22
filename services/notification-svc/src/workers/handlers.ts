/**
 * BullMQ worker handlers.
 *
 * One worker per queue. Each handler does the channel-specific I/O and
 * updates the corresponding `deliveries` row with the outcome.
 */

import { Worker, type Job } from 'bullmq';

import { getBullMQConnection } from '@/clients/redis.js';
import { getLogger } from '@/config/logger.js';
import { query } from '@/db/pool.js';
import { sendEmail } from '@/channels/email.js';
import { dispatchWebhook } from '@/channels/webhook.js';
import { getRoute } from '@/services/event_routes.js';
import { compileMjml, render } from '@/services/templates.js';
import type { Channel, TemplateRow, WebhookRow, DeliveryStatus } from '@/models/rows.js';

import { BullQueues } from './queues.js';

const log = getLogger('workers');

// =============================================================================
// Helpers
// =============================================================================

async function loadTemplate(
  templateCode: string,
  channel: Channel,
  locale: string,
): Promise<TemplateRow | null> {
  const result = await query<TemplateRow>(
    `
    SELECT * FROM notification.templates
    WHERE code = $1 AND channel = $2 AND locale = $3 AND is_active = TRUE
    LIMIT 1
    `,
    [templateCode, channel, locale],
  );
  if (result.rows.length > 0) return result.rows[0]!;
  // Fall back to 'en'
  if (locale !== 'en') {
    const fallback = await query<TemplateRow>(
      `
      SELECT * FROM notification.templates
      WHERE code = $1 AND channel = $2 AND locale = 'en' AND is_active = TRUE
      LIMIT 1
      `,
      [templateCode, channel],
    );
    return fallback.rows[0] ?? null;
  }
  return null;
}

async function updateDeliveryOutcome(args: {
  delivery_id: string;
  status: DeliveryStatus;
  provider?: string | null;
  provider_msg_id?: string | null;
  failure_reason?: string | null;
  latency_ms?: number | null;
}): Promise<void> {
  await query(
    `
    UPDATE notification.deliveries
       SET status = $1,
           provider = COALESCE($2, provider),
           provider_msg_id = COALESCE($3, provider_msg_id),
           failure_reason = $4,
           latency_ms = COALESCE($5, latency_ms),
           sent_at = CASE WHEN $1 IN ('sent','delivered') THEN NOW() ELSE sent_at END,
           attempt = attempt + 1
     WHERE id = $6
    `,
    [
      args.status,
      args.provider ?? null,
      args.provider_msg_id ?? null,
      args.failure_reason ?? null,
      args.latency_ms ?? null,
      args.delivery_id,
    ],
  );
}

// =============================================================================
// Email worker
// =============================================================================

interface EmailJobData {
  delivery_id: string;
  user_id: string;
  email_address: string;
  locale: string;
  event_id: string;
  event_type: string;
  template_code: string | null;
  variables: Record<string, unknown>;
  priority: string;
}

export function createEmailWorker(): Worker<EmailJobData> {
  return new Worker<EmailJobData>(
    BullQueues.EmailDelivery,
    async (job: Job<EmailJobData>) => {
      const d = job.data;
      log.info({ job_id: job.id, event_type: d.event_type, user_id: d.user_id }, 'email_send_start');

      const route = getRoute(d.event_type);
      const templateCode = d.template_code ?? route?.templateCode ?? null;
      if (!templateCode) {
        await updateDeliveryOutcome({
          delivery_id: d.delivery_id,
          status: 'dropped',
          failure_reason: 'no template code resolved for event_type',
        });
        return { skipped: 'no_template' };
      }
      const template = await loadTemplate(templateCode, 'email', d.locale);
      if (!template) {
        await updateDeliveryOutcome({
          delivery_id: d.delivery_id,
          status: 'dropped',
          failure_reason: `no email template found for ${templateCode}/${d.locale}`,
        });
        return { skipped: 'no_template_row' };
      }

      const rendered = render({
        channel: 'email',
        subject_template: template.subject,
        body_source: template.body_source,
        body_compiled: template.body_compiled,
        variables: d.variables,
      });

      try {
        const result = await sendEmail({
          to: d.email_address,
          subject: rendered.subject ?? `Notification from Offense Conditions`,
          html: rendered.body_html ?? '',
          text: rendered.body_text,
          tags: [
            { name: 'event_type', value: d.event_type.replace(/[^A-Za-z0-9_-]/g, '_') },
            { name: 'priority', value: d.priority },
          ],
        });
        await updateDeliveryOutcome({
          delivery_id: d.delivery_id,
          status: 'sent',
          provider: result.provider,
          provider_msg_id: result.provider_msg_id,
          latency_ms: result.latency_ms,
        });
        return { ok: true, provider: result.provider };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        await updateDeliveryOutcome({
          delivery_id: d.delivery_id,
          status: 'failed',
          failure_reason: reason,
        });
        throw err;
      }
    },
    {
      connection: getBullMQConnection(),
      concurrency: 8,
      removeOnComplete: { age: 86_400, count: 1000 },
      removeOnFail: { age: 7 * 86_400 },
    },
  );
}

// =============================================================================
// Webhook worker
// =============================================================================

interface WebhookJobData {
  delivery_id: string;
  webhook_id: string;
  event_id: string;
  event_type: string;
  payload: Record<string, unknown>;
}

export function createWebhookWorker(): Worker<WebhookJobData> {
  return new Worker<WebhookJobData>(
    BullQueues.WebhookDelivery,
    async (job: Job<WebhookJobData>) => {
      const d = job.data;
      const whResult = await query<WebhookRow>(
        `SELECT * FROM notification.webhooks WHERE id = $1`,
        [d.webhook_id],
      );
      const webhook = whResult.rows[0];
      if (!webhook || !webhook.is_active || webhook.disabled_at) {
        await updateDeliveryOutcome({
          delivery_id: d.delivery_id,
          status: 'dropped',
          failure_reason: 'webhook disabled or deleted',
        });
        return { skipped: 'webhook_disabled' };
      }

      const result = await dispatchWebhook({
        url: webhook.url,
        secret: webhook.secret,
        event: {
          event_id: d.event_id,
          event_type: d.event_type,
          occurred_at: new Date().toISOString(),
          payload: d.payload,
        },
      });

      await updateDeliveryOutcome({
        delivery_id: d.delivery_id,
        status: result.status === 'sent' ? 'sent' : 'failed',
        provider: 'self',
        failure_reason: result.failure_reason,
        latency_ms: result.latency_ms,
      });

      // Update the webhook's health counters
      if (result.status === 'sent') {
        await query(
          `
          UPDATE notification.webhooks
             SET failure_count = 0,
                 last_success_at = NOW(),
                 last_failure_msg = NULL,
                 updated_at = NOW()
           WHERE id = $1
          `,
          [webhook.id],
        );
      } else {
        await query(
          `
          UPDATE notification.webhooks
             SET failure_count = failure_count + 1,
                 last_failure_at = NOW(),
                 last_failure_msg = $1,
                 disabled_at = CASE WHEN failure_count + 1 >= 20 THEN NOW() ELSE disabled_at END,
                 is_active = CASE WHEN failure_count + 1 >= 20 THEN FALSE ELSE is_active END,
                 updated_at = NOW()
           WHERE id = $2
          `,
          [result.failure_reason?.slice(0, 1000) ?? null, webhook.id],
        );
        // Trigger BullMQ retry by throwing
        if (result.failure_reason) {
          throw new Error(result.failure_reason);
        }
      }
      return { ok: result.status === 'sent', http_status: result.http_status };
    },
    {
      connection: getBullMQConnection(),
      concurrency: 16,
      removeOnComplete: { age: 86_400, count: 1000 },
      removeOnFail: { age: 7 * 86_400 },
    },
  );
}

// =============================================================================
// Template render worker (pre-compile MJML on a schedule)
// =============================================================================

export function createTemplateRenderWorker(): Worker {
  return new Worker(
    BullQueues.TemplateRender,
    async (job) => {
      const { template_id } = job.data as { template_id?: string };
      log.info({ template_id }, 'template_render_start');

      // If no specific template, walk all email templates with missing compiled HTML
      const result = await query<TemplateRow>(
        template_id
          ? `SELECT * FROM notification.templates WHERE id = $1`
          : `SELECT * FROM notification.templates WHERE channel = 'email' AND body_compiled IS NULL`,
        template_id ? [template_id] : [],
      );

      let compiled = 0;
      for (const tpl of result.rows) {
        if (tpl.channel !== 'email') continue;
        try {
          const html = compileMjml(tpl.body_source);
          await query(
            `UPDATE notification.templates SET body_compiled = $1, updated_at = NOW() WHERE id = $2`,
            [html, tpl.id],
          );
          compiled++;
        } catch (err) {
          log.warn({ err, template_id: tpl.id }, 'template_compile_failed');
        }
      }
      return { compiled };
    },
    { connection: getBullMQConnection(), concurrency: 2 },
  );
}

// =============================================================================
// Digest rollup worker
// =============================================================================

export function createDigestWorker(): Worker {
  return new Worker(
    BullQueues.DigestRollup,
    async (job) => {
      const { user_id, frequency } = job.data as { user_id: string; frequency: 'daily' | 'weekly' };
      log.info({ user_id, frequency }, 'digest_rollup_start');
      // Implementation deferred to v1.1: query unread low-priority notifications
      // since the last digest send, render the digest template, send via email
      // channel, mark digest_sent_at.
      return { ok: true };
    },
    { connection: getBullMQConnection(), concurrency: 4 },
  );
}
