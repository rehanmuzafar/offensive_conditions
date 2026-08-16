/**
 * gRPC server (JSON-over-gRPC, same pattern as payment-svc).
 *
 * Used by other internal services to directly send a notification
 * (e.g. auth-svc on password reset) without going through Kafka.
 */

import * as grpc from '@grpc/grpc-js';

import { getConfig } from '@/config/index.js';
import { getLogger } from '@/config/logger.js';
import { query } from '@/db/pool.js';
import { sendDirect } from '@/services/dispatcher.js';
import type { NotificationRow, PreferenceRow } from '@/models/rows.js';

const log = getLogger('grpc');

let _server: grpc.Server | null = null;

function jsonSerialize<T>(value: T): Buffer {
  return Buffer.from(JSON.stringify(value), 'utf-8');
}

function jsonDeserialize<T>(buffer: Buffer): T {
  return buffer.length === 0 ? ({} as T) : (JSON.parse(buffer.toString('utf-8')) as T);
}

// =============================================================================
// Handlers
// =============================================================================

interface SendInput {
  user_id: string;
  event_id?: string;
  event_type: string;
  channels?: string[];
  priority?: string;
  variables?: Record<string, unknown>;
  title?: string;
  body?: string;
  action_url?: string;
}

interface SendResponse {
  delivery_ids: string[];
  channels_used: string[];
  channels_skipped: string[];
}

async function sendNotification(
  call: grpc.ServerUnaryCall<SendInput, SendResponse>,
  callback: grpc.sendUnaryData<SendResponse>,
): Promise<void> {
  try {
    const req = call.request;
    if (!req.user_id || !req.event_type) {
      callback({ code: grpc.status.INVALID_ARGUMENT, message: 'user_id + event_type required' });
      return;
    }
    const allowed = ['email', 'in_app', 'webhook', 'push', 'sms'] as const;
    type Channel = (typeof allowed)[number];
    const channelsRaw = (req.channels ?? []).filter((c): c is Channel =>
      (allowed as readonly string[]).includes(c),
    );

    const allowedPriority = ['low', 'normal', 'high', 'urgent'] as const;
    type Priority = (typeof allowedPriority)[number];
    const priority =
      req.priority && (allowedPriority as readonly string[]).includes(req.priority)
        ? (req.priority as Priority)
        : undefined;

    const outcome = await sendDirect({
      user_id: req.user_id,
      event_id: req.event_id,
      event_type: req.event_type,
      channels: channelsRaw.length > 0 ? channelsRaw : undefined,
      priority,
      variables: req.variables ?? {},
      title: req.title,
      body: req.body,
      action_url: req.action_url,
    });
    callback(null, {
      delivery_ids: outcome.delivery_ids,
      channels_used: outcome.channels_used,
      channels_skipped: outcome.channels_skipped,
    });
  } catch (err) {
    log.error({ err }, 'grpc_send_notification_failed');
    callback({ code: grpc.status.INTERNAL, message: (err as Error).message });
  }
}

async function getUnreadCount(
  call: grpc.ServerUnaryCall<{ user_id: string }, { count: number }>,
  callback: grpc.sendUnaryData<{ count: number }>,
): Promise<void> {
  try {
    const userId = call.request.user_id;
    if (!userId) {
      callback({ code: grpc.status.INVALID_ARGUMENT, message: 'user_id required' });
      return;
    }
    const result = await query<{ count: string }>(
      `
      SELECT COUNT(*)::TEXT AS count FROM notification.notifications
      WHERE user_id = $1 AND read_at IS NULL AND deleted_at IS NULL
      `,
      [userId],
    );
    callback(null, { count: Number(result.rows[0]!.count) });
  } catch (err) {
    log.error({ err }, 'grpc_get_unread_count_failed');
    callback({ code: grpc.status.INTERNAL, message: 'internal error' });
  }
}

async function getUserPreferences(
  call: grpc.ServerUnaryCall<{ user_id: string }, { preferences: PreferenceRow[] }>,
  callback: grpc.sendUnaryData<{ preferences: PreferenceRow[] }>,
): Promise<void> {
  try {
    const userId = call.request.user_id;
    if (!userId) {
      callback({ code: grpc.status.INVALID_ARGUMENT, message: 'user_id required' });
      return;
    }
    const result = await query<PreferenceRow>(
      `SELECT * FROM notification.preferences WHERE user_id = $1`,
      [userId],
    );
    callback(null, { preferences: result.rows });
  } catch (err) {
    log.error({ err }, 'grpc_get_user_preferences_failed');
    callback({ code: grpc.status.INTERNAL, message: 'internal error' });
  }
}

async function listRecentNotifications(
  call: grpc.ServerUnaryCall<{ user_id: string; limit?: number }, { notifications: NotificationRow[] }>,
  callback: grpc.sendUnaryData<{ notifications: NotificationRow[] }>,
): Promise<void> {
  try {
    const userId = call.request.user_id;
    if (!userId) {
      callback({ code: grpc.status.INVALID_ARGUMENT, message: 'user_id required' });
      return;
    }
    const limit = Math.min(100, Math.max(1, call.request.limit ?? 10));
    const result = await query<NotificationRow>(
      `
      SELECT * FROM notification.notifications
      WHERE user_id = $1 AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT $2
      `,
      [userId, limit],
    );
    callback(null, { notifications: result.rows });
  } catch (err) {
    log.error({ err }, 'grpc_list_recent_failed');
    callback({ code: grpc.status.INTERNAL, message: 'internal error' });
  }
}

function buildServiceDefinition(): grpc.ServiceDefinition {
  const make = (path: string) => ({
    path,
    requestStream: false,
    responseStream: false,
    requestSerialize: jsonSerialize,
    requestDeserialize: jsonDeserialize,
    responseSerialize: jsonSerialize,
    responseDeserialize: jsonDeserialize,
  });
  return {
    SendNotification: make('/offcon.notification.v1.NotificationService/SendNotification'),
    GetUnreadCount: make('/offcon.notification.v1.NotificationService/GetUnreadCount'),
    GetUserPreferences: make('/offcon.notification.v1.NotificationService/GetUserPreferences'),
    ListRecentNotifications: make('/offcon.notification.v1.NotificationService/ListRecentNotifications'),
  };
}

export function startGrpcServer(): grpc.Server {
  if (_server !== null) return _server;
  const cfg = getConfig();
  const server = new grpc.Server({
    'grpc.max_receive_message_length': 8 * 1024 * 1024,
    'grpc.max_send_message_length': 8 * 1024 * 1024,
    'grpc.keepalive_time_ms': 30_000,
    'grpc.keepalive_timeout_ms': 10_000,
  });

  server.addService(buildServiceDefinition(), {
    SendNotification: sendNotification,
    GetUnreadCount: getUnreadCount,
    GetUserPreferences: getUserPreferences,
    ListRecentNotifications: listRecentNotifications,
  } as grpc.UntypedServiceImplementation);

  const addr = `0.0.0.0:${cfg.GRPC_PORT}`;
  server.bindAsync(addr, grpc.ServerCredentials.createInsecure(), (err, port) => {
    if (err) {
      log.error({ err, addr }, 'grpc_bind_failed');
      return;
    }
    log.info({ port }, 'grpc_listening');
  });

  _server = server;
  return server;
}

export async function stopGrpcServer(graceMs = 10_000): Promise<void> {
  if (_server === null) return;
  const server = _server;
  _server = null;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      server.forceShutdown();
      resolve();
    }, graceMs);
    server.tryShutdown((err) => {
      clearTimeout(timer);
      if (err) log.warn({ err }, 'grpc_graceful_shutdown_error');
      resolve();
    });
  });
}
