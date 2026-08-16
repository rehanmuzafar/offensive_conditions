/**
 * HTTP + gRPC server entrypoint.
 *
 * Starts: Fastify HTTP on :8008, gRPC on :9008, WebSocket on
 * /v1/ws/notifications. Workers + Kafka consumer run as separate processes.
 */

import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import websocket from '@fastify/websocket';

import { loadConfig } from '@/config/index.js';
import { getLogger } from '@/config/logger.js';
import { closePool, initPool } from '@/db/pool.js';
import { closeRedis, getRedis } from '@/clients/redis.js';
import { startGrpcServer, stopGrpcServer } from '@/grpc/server.js';
import { closeAllQueues } from '@/workers/queues.js';
import { registerAdminRoutes } from '@/api/v1/admin.js';
import { registerHealthRoutes } from '@/api/v1/health.js';
import { registerMeRoutes } from '@/api/v1/me.js';
import { registerWebhookRoutes } from '@/api/v1/webhooks.js';
import { registerWebSocketRoutes } from '@/api/v1/ws.js';
import { registerAuth } from '@/middleware/auth.js';
import { registerErrorHandler, registerRequestContext } from '@/middleware/context.js';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const log = getLogger('server');
  log.info({ env: cfg.APP_ENV, version: cfg.APP_VERSION }, 'starting_notification_svc');

  initPool();
  getRedis();

  const app = Fastify({
    logger: false,
    bodyLimit: 1024 * 1024 * 2,
    trustProxy: true,
    disableRequestLogging: true,
  });

  // Teach Fastify to validate/serialize using the route Zod schemas.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: cfg.HTTP_CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    exposedHeaders: ['X-Request-ID'],
  });
  await app.register(sensible);
  await app.register(rateLimit, {
    max: 200,
    timeWindow: '1 minute',
    redis: getRedis(),
    keyGenerator: (req) => `rl:${req.ip}:${req.url}`,
    skipOnError: true,
  });
  await app.register(websocket, {
    options: {
      maxPayload: 64 * 1024,
      clientTracking: true,
    },
  });

  registerRequestContext(app);
  registerErrorHandler(app);
  await registerAuth(app);

  await registerHealthRoutes(app);
  await registerMeRoutes(app);
  await registerWebhookRoutes(app);
  await registerAdminRoutes(app);
  await registerWebSocketRoutes(app);

  startGrpcServer();

  try {
    await app.listen({ host: cfg.HTTP_HOST, port: cfg.HTTP_PORT });
    log.info({ port: cfg.HTTP_PORT, host: cfg.HTTP_HOST }, 'http_listening');
  } catch (err) {
    log.error({ err }, 'http_listen_failed');
    process.exit(1);
  }

  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal }, 'shutdown_received');
    try {
      await app.close();
      await stopGrpcServer();
      await closeAllQueues();
      await closeRedis();
      await closePool();
      log.info('shutdown_complete');
      process.exit(0);
    } catch (err) {
      log.error({ err }, 'shutdown_failed');
      process.exit(1);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => {
    log.fatal({ err }, 'uncaught_exception');
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    log.fatal({ reason }, 'unhandled_rejection');
    process.exit(1);
  });
}

void main();
