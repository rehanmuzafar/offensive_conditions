/**
 * gRPC server.
 *
 * Like the Python services, we serialize as JSON over gRPC to avoid the
 * proto-gen step in CI (the sandbox can't fetch protoc from the network).
 * The .proto file at `proto/payment.proto` documents the wire contract.
 */

import * as grpc from '@grpc/grpc-js';

import { getConfig } from '@/config/index.js';
import { getLogger } from '@/config/logger.js';
import { getActiveSubscriptionForUser, listSubscriptionsForUser } from '@/services/subscriptions.js';
import { getPlanByCode } from '@/services/plans.js';

const log = getLogger('grpc');

let _server: grpc.Server | null = null;

interface TierResponse {
  user_id: string;
  tier: string;
  status: string;
  current_period_end: string | null;
  max_concurrent_instances: number;
  max_daily_spawns: number;
}

interface SubscriptionResponse {
  has_subscription: boolean;
  subscription_id: string | null;
  plan_code: string | null;
  tier: string;
  status: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

interface FeatureCheckResponse {
  enabled: boolean;
  reason: string;
}

function jsonSerialize<T>(value: T): Buffer {
  return Buffer.from(JSON.stringify(value), 'utf-8');
}

function jsonDeserialize<T>(buffer: Buffer): T {
  return buffer.length === 0 ? ({} as T) : (JSON.parse(buffer.toString('utf-8')) as T);
}

// =============================================================================
// Handlers
// =============================================================================

async function getUserTier(
  call: grpc.ServerUnaryCall<{ user_id: string }, TierResponse>,
  callback: grpc.sendUnaryData<TierResponse>,
): Promise<void> {
  try {
    const userId = call.request.user_id;
    if (!userId) {
      callback({ code: grpc.status.INVALID_ARGUMENT, message: 'user_id required' });
      return;
    }
    const active = await getActiveSubscriptionForUser(userId);
    if (!active) {
      callback(null, {
        user_id: userId,
        tier: 'free',
        status: 'none',
        current_period_end: null,
        max_concurrent_instances: 1,
        max_daily_spawns: 5,
      });
      return;
    }
    callback(null, {
      user_id: userId,
      tier: active.plan.tier,
      status: active.subscription.status,
      current_period_end: active.subscription.current_period_end.toISOString(),
      max_concurrent_instances: active.plan.max_concurrent_instances ?? 2,
      max_daily_spawns: active.plan.max_daily_spawns ?? 10,
    });
  } catch (err) {
    log.error({ err }, 'grpc_get_user_tier_failed');
    callback({ code: grpc.status.INTERNAL, message: 'internal error' });
  }
}

async function getUserSubscription(
  call: grpc.ServerUnaryCall<{ user_id: string }, SubscriptionResponse>,
  callback: grpc.sendUnaryData<SubscriptionResponse>,
): Promise<void> {
  try {
    const userId = call.request.user_id;
    if (!userId) {
      callback({ code: grpc.status.INVALID_ARGUMENT, message: 'user_id required' });
      return;
    }
    const active = await getActiveSubscriptionForUser(userId);
    if (!active) {
      callback(null, {
        has_subscription: false,
        subscription_id: null,
        plan_code: null,
        tier: 'free',
        status: null,
        current_period_end: null,
        cancel_at_period_end: false,
      });
      return;
    }
    callback(null, {
      has_subscription: true,
      subscription_id: active.subscription.id,
      plan_code: active.plan.code,
      tier: active.plan.tier,
      status: active.subscription.status,
      current_period_end: active.subscription.current_period_end.toISOString(),
      cancel_at_period_end: active.subscription.cancel_at_period_end,
    });
  } catch (err) {
    log.error({ err }, 'grpc_get_user_subscription_failed');
    callback({ code: grpc.status.INTERNAL, message: 'internal error' });
  }
}

async function isFeatureEnabled(
  call: grpc.ServerUnaryCall<{ user_id: string; feature_code: string }, FeatureCheckResponse>,
  callback: grpc.sendUnaryData<FeatureCheckResponse>,
): Promise<void> {
  try {
    const { user_id, feature_code } = call.request;
    if (!user_id || !feature_code) {
      callback({ code: grpc.status.INVALID_ARGUMENT, message: 'user_id + feature_code required' });
      return;
    }
    const active = await getActiveSubscriptionForUser(user_id);
    if (!active) {
      callback(null, { enabled: false, reason: 'no_active_subscription' });
      return;
    }
    const features = active.plan.features ?? [];
    const enabled = features.includes(feature_code);
    callback(null, {
      enabled,
      reason: enabled ? '' : `plan ${active.plan.code} does not include feature ${feature_code}`,
    });
  } catch (err) {
    log.error({ err }, 'grpc_is_feature_enabled_failed');
    callback({ code: grpc.status.INTERNAL, message: 'internal error' });
  }
}

async function getSubscriptionHistory(
  call: grpc.ServerUnaryCall<{ user_id: string }, { subscriptions: unknown[] }>,
  callback: grpc.sendUnaryData<{ subscriptions: unknown[] }>,
): Promise<void> {
  try {
    const userId = call.request.user_id;
    if (!userId) {
      callback({ code: grpc.status.INVALID_ARGUMENT, message: 'user_id required' });
      return;
    }
    const subs = await listSubscriptionsForUser(userId);
    callback(null, { subscriptions: subs });
  } catch (err) {
    log.error({ err }, 'grpc_get_subscription_history_failed');
    callback({ code: grpc.status.INTERNAL, message: 'internal error' });
  }
}

// =============================================================================
// Server construction
// =============================================================================

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
    GetUserTier: make('/offcon.payment.v1.PaymentService/GetUserTier'),
    GetUserSubscription: make('/offcon.payment.v1.PaymentService/GetUserSubscription'),
    IsFeatureEnabled: make('/offcon.payment.v1.PaymentService/IsFeatureEnabled'),
    GetSubscriptionHistory: make('/offcon.payment.v1.PaymentService/GetSubscriptionHistory'),
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
    GetUserTier: getUserTier,
    GetUserSubscription: getUserSubscription,
    IsFeatureEnabled: isFeatureEnabled,
    GetSubscriptionHistory: getSubscriptionHistory,
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
      if (err) {
        log.warn({ err }, 'grpc_graceful_shutdown_error');
      }
      resolve();
    });
  });
  log.info('grpc_stopped');
}

// Used by callers that want to silence the unused warning for the plan lookup
// helper if they wire that path later. Keeps the import alive without runtime cost.
export const __planLookupRef = getPlanByCode;
