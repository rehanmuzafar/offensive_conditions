/**
 * Notification dispatcher.
 *
 * Given an inbound event (from Kafka or direct API), this module:
 *   1. Looks up the routing spec in EVENT_ROUTES
 *   2. Checks user preferences + quiet-hours + master_unsubscribe
 *   3. For each enabled channel, creates a `delivery` row and enqueues
 *      a BullMQ job for the channel-specific worker
 *   4. For in-app, writes a `notifications` row directly (no async wait)
 *
 * The actual provider calls happen in workers — see `src/workers/`.
 */

import { randomUUID } from 'node:crypto';

import { getLogger } from '@/config/logger.js';
import { query } from '@/db/pool.js';
import type {
  Channel,
  DeliveryRow,
  DeliveryStatus,
  NotificationRow,
  PreferenceRow,
  Priority,
  UserSettingsRow,
  WebhookRow,
} from '@/models/rows.js';
import { compileInline } from '@/services/templates.js';
import { getRoute } from '@/services/event_routes.js';
import { BullQueues, getQueue } from '@/workers/queues.js';

const log = getLogger('dispatch');

export interface DispatchInput {
  user_id: string;
  event_id: string;
  event_type: string;
  /** Override route — service-to-service callers can force channels */
  channels?: Channel[];
  /** Override priority */
  priority?: Priority;
  /** Variables for template rendering */
  variables: Record<string, unknown>;
  /** Direct content override (skips template lookup) */
  title?: string;
  body?: string;
  action_url?: string;
}

export interface DispatchOutcome {
  delivery_ids: string[];
  channels_used: Channel[];
  channels_skipped: Channel[];
  reason_skipped: Record<string, string>;
}

// =============================================================================
// Helpers
// =============================================================================

async function getUserSettings(userId: string): Promise<UserSettingsRow | null> {
  const result = await query<UserSettingsRow>(
    `SELECT * FROM notification.user_settings WHERE user_id = $1`,
    [userId],
  );
  return result.rows[0] ?? null;
}

async function getPreference(userId: string, eventType: string): Promise<PreferenceRow | null> {
  const result = await query<PreferenceRow>(
    `SELECT * FROM notification.preferences WHERE user_id = $1 AND event_type = $2`,
    [userId, eventType],
  );
  return result.rows[0] ?? null;
}

async function getActiveWebhooksForUser(userId: string, eventType: string): Promise<WebhookRow[]> {
  const result = await query<WebhookRow>(
    `
    SELECT * FROM notification.webhooks
    WHERE user_id = $1
      AND is_active = TRUE
      AND disabled_at IS NULL
      AND (
        '*' = ANY(event_types)
        OR $2 = ANY(event_types)
      )
    `,
    [userId, eventType],
  );
  return result.rows;
}

function isInQuietHours(settings: UserSettingsRow, now: Date): boolean {
  if (!settings.respect_quiet) return false;
  // Compute the user's local hour. Cheap approach: shift by their timezone
  // using Intl.DateTimeFormat.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: settings.timezone,
    hour: 'numeric',
    hour12: false,
  });
  const hourStr = fmt.format(now);
  const hour = Number(hourStr === '24' ? '0' : hourStr);
  const start = settings.quiet_hours_start;
  const end = settings.quiet_hours_end;
  if (start === end) return false;
  if (start < end) {
    return hour >= start && hour < end;
  }
  // Wraps midnight, e.g. 22→7
  return hour >= start || hour < end;
}

function isChannelEnabled(pref: PreferenceRow | null, channel: Channel): boolean {
  if (!pref) return true;  // default: all channels on
  switch (channel) {
    case 'email':
      return pref.email_enabled;
    case 'in_app':
      return pref.in_app_enabled;
    case 'push':
      return pref.push_enabled;
    case 'sms':
      return pref.sms_enabled;
    case 'webhook':
      return true;  // webhook always uses the webhooks table for opt-in
  }
}

// =============================================================================
// Delivery + notification writes
// =============================================================================

async function createDeliveryRow(args: {
  userId: string;
  eventId: string;
  eventType: string;
  channel: Channel;
  status: DeliveryStatus;
  notificationId?: string | null;
  webhookId?: string | null;
}): Promise<DeliveryRow> {
  const result = await query<DeliveryRow>(
    `
    INSERT INTO notification.deliveries (
      user_id, notification_id, webhook_id, event_id, event_type, channel, status, attempt
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, 1)
    RETURNING *
    `,
    [
      args.userId,
      args.notificationId ?? null,
      args.webhookId ?? null,
      args.eventId,
      args.eventType,
      args.channel,
      args.status,
    ],
  );
  return result.rows[0]!;
}

async function createInAppNotification(args: {
  userId: string;
  eventId: string;
  eventType: string;
  priority: Priority;
  title: string;
  body: string;
  actionUrl: string | null;
  icon: string | null;
  metadata: Record<string, unknown>;
}): Promise<NotificationRow | null> {
  try {
    const result = await query<NotificationRow>(
      `
      INSERT INTO notification.notifications (
        user_id, event_id, event_type, priority, title, body, action_url, icon, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::JSONB)
      RETURNING *
      `,
      [
        args.userId,
        args.eventId,
        args.eventType,
        args.priority,
        args.title,
        args.body,
        args.actionUrl,
        args.icon,
        JSON.stringify(args.metadata),
      ],
    );
    return result.rows[0]!;
  } catch (err) {
    const pgCode = (err as { code?: string }).code;
    if (pgCode === '23505') {
      // Duplicate (user_id, event_id, event_type) — idempotent, returning existing
      const existing = await query<NotificationRow>(
        `
        SELECT * FROM notification.notifications
        WHERE user_id = $1 AND event_id = $2 AND event_type = $3
        LIMIT 1
        `,
        [args.userId, args.eventId, args.eventType],
      );
      return existing.rows[0] ?? null;
    }
    throw err;
  }
}

// =============================================================================
// Public entry point
// =============================================================================

export async function dispatchEvent(input: DispatchInput): Promise<DispatchOutcome> {
  const route = getRoute(input.event_type);
  const channels: Channel[] = input.channels ?? route?.channels ?? ['in_app'];
  const priority: Priority = input.priority ?? route?.priority ?? 'normal';

  const settings = await getUserSettings(input.user_id);
  const pref = await getPreference(input.user_id, input.event_type);

  const outcome: DispatchOutcome = {
    delivery_ids: [],
    channels_used: [],
    channels_skipped: [],
    reason_skipped: {},
  };

  // master_unsubscribe disables everything except urgent
  if (settings?.master_unsubscribe && priority !== 'urgent') {
    for (const c of channels) {
      outcome.channels_skipped.push(c);
      outcome.reason_skipped[c] = 'master_unsubscribe';
    }
    return outcome;
  }

  // Quiet hours — non-urgent emails get deferred to the morning. In-app + webhook
  // ignore quiet hours.
  const deferEmail =
    settings &&
    priority !== 'urgent' &&
    isInQuietHours(settings, new Date()) &&
    channels.includes('email');

  // Build inline title + body if route has them and caller didn't override
  const renderedTitle = input.title ?? (route ? compileInline(route.inAppTitle, input.variables) : '');
  const renderedBody = input.body ?? (route ? compileInline(route.inAppBody, input.variables) : '');
  const actionUrl =
    input.action_url ??
    (route?.actionUrlTemplate ? compileInline(route.actionUrlTemplate, input.variables) : null);
  const icon = route?.icon ?? null;

  // -------- in-app --------
  if (channels.includes('in_app')) {
    if (!isChannelEnabled(pref, 'in_app')) {
      outcome.channels_skipped.push('in_app');
      outcome.reason_skipped.in_app = 'user_opted_out';
    } else {
      const notif = await createInAppNotification({
        userId: input.user_id,
        eventId: input.event_id,
        eventType: input.event_type,
        priority,
        title: renderedTitle || input.event_type,
        body: renderedBody || '',
        actionUrl,
        icon,
        metadata: input.variables,
      });
      const delivery = await createDeliveryRow({
        userId: input.user_id,
        eventId: input.event_id,
        eventType: input.event_type,
        channel: 'in_app',
        status: notif ? 'delivered' : 'failed',
        notificationId: notif?.id ?? null,
      });
      outcome.delivery_ids.push(delivery.id);
      outcome.channels_used.push('in_app');
      // Push to WS subscribers (handled out of band by pubsub)
      await publishLiveNotification(input.user_id, notif);
    }
  }

  // -------- email --------
  if (channels.includes('email')) {
    if (!isChannelEnabled(pref, 'email')) {
      outcome.channels_skipped.push('email');
      outcome.reason_skipped.email = 'user_opted_out';
    } else if (!settings?.email_address) {
      outcome.channels_skipped.push('email');
      outcome.reason_skipped.email = 'no_email_address';
    } else {
      const delivery = await createDeliveryRow({
        userId: input.user_id,
        eventId: input.event_id,
        eventType: input.event_type,
        channel: 'email',
        status: 'pending',
      });
      outcome.delivery_ids.push(delivery.id);
      outcome.channels_used.push('email');
      const delay = deferEmail ? computeDelayToMorning(settings!) : 0;
      await getQueue(BullQueues.EmailDelivery).add(
        input.event_type,
        {
          delivery_id: delivery.id,
          user_id: input.user_id,
          email_address: settings!.email_address,
          locale: settings!.preferred_locale,
          event_id: input.event_id,
          event_type: input.event_type,
          template_code: route?.templateCode ?? null,
          variables: input.variables,
          priority,
        },
        { delay, removeOnComplete: 1000, removeOnFail: 5000 },
      );
    }
  }

  // -------- webhook (outbound) --------
  // The webhook channel always opts in via the webhooks table — there is no
  // global toggle in preferences.
  const webhooks = await getActiveWebhooksForUser(input.user_id, input.event_type);
  for (const wh of webhooks) {
    const delivery = await createDeliveryRow({
      userId: input.user_id,
      eventId: input.event_id,
      eventType: input.event_type,
      channel: 'webhook',
      status: 'pending',
      webhookId: wh.id,
    });
    outcome.delivery_ids.push(delivery.id);
    if (!outcome.channels_used.includes('webhook')) outcome.channels_used.push('webhook');
    await getQueue(BullQueues.WebhookDelivery).add(
      input.event_type,
      {
        delivery_id: delivery.id,
        webhook_id: wh.id,
        event_id: input.event_id,
        event_type: input.event_type,
        payload: {
          ...input.variables,
          title: renderedTitle,
          body: renderedBody,
          action_url: actionUrl,
        },
      },
      { removeOnComplete: 1000, removeOnFail: 5000 },
    );
  }

  log.info(
    {
      event_id: input.event_id,
      event_type: input.event_type,
      user_id: input.user_id,
      channels_used: outcome.channels_used,
      channels_skipped: outcome.channels_skipped,
    },
    'event_dispatched',
  );
  return outcome;
}

function computeDelayToMorning(settings: UserSettingsRow): number {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: settings.timezone,
    hour: 'numeric',
    hour12: false,
  });
  const hourStr = fmt.format(now);
  const currentHour = Number(hourStr === '24' ? '0' : hourStr);
  const endHour = settings.quiet_hours_end;
  let hoursUntil = endHour - currentHour;
  if (hoursUntil <= 0) hoursUntil += 24;
  return hoursUntil * 3600 * 1000;
}

async function publishLiveNotification(
  userId: string,
  notif: NotificationRow | null,
): Promise<void> {
  if (!notif) return;
  // Lazy import to avoid circular ref + only load when actually used
  try {
    const { getRedis } = await import('@/clients/redis.js');
    const redis = getRedis();
    const channel = `notifications:user:${userId}`;
    await redis.publish(channel, JSON.stringify({
      id: notif.id,
      title: notif.title,
      body: notif.body,
      priority: notif.priority,
      action_url: notif.action_url,
      icon: notif.icon,
      created_at: notif.created_at.toISOString(),
    }));
  } catch (err) {
    log.debug({ err }, 'live_publish_skipped');
  }
}

// =============================================================================
// Idempotency
// =============================================================================

export async function markEventConsumed(opts: {
  event_id: string;
  source_topic: string;
  event_type: string;
  kafka_offset?: string | null;
  kafka_partition?: number | null;
}): Promise<boolean> {
  try {
    await query(
      `
      INSERT INTO notification.consumed_events (event_id, source_topic, event_type, kafka_offset, kafka_partition)
      VALUES ($1, $2, $3, $4, $5)
      `,
      [opts.event_id, opts.source_topic, opts.event_type, opts.kafka_offset ?? null, opts.kafka_partition ?? null],
    );
    return true;
  } catch (err) {
    const pgCode = (err as { code?: string }).code;
    if (pgCode === '23505') {
      return false;  // already consumed
    }
    throw err;
  }
}

/**
 * Direct service-to-service send (used by gRPC + internal HTTP endpoint).
 * Generates an event_id if not provided. Always passes through dispatchEvent
 * to keep one code path.
 */
export async function sendDirect(opts: {
  user_id: string;
  event_id?: string;
  event_type: string;
  channels?: Channel[];
  priority?: Priority;
  variables: Record<string, unknown>;
  title?: string;
  body?: string;
  action_url?: string;
}): Promise<DispatchOutcome> {
  const eventId = opts.event_id ?? randomUUID();
  return dispatchEvent({
    user_id: opts.user_id,
    event_id: eventId,
    event_type: opts.event_type,
    channels: opts.channels,
    priority: opts.priority,
    variables: opts.variables,
    title: opts.title,
    body: opts.body,
    action_url: opts.action_url,
  });
}
