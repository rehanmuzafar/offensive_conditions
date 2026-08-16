/**
 * WebSocket route for live notification delivery.
 *
 * Authenticated via `?token=` query param (browsers can't send custom headers
 * on WS handshake). The connection subscribes to `notifications:user:{id}` on
 * Redis pubsub. Every message published there (by the dispatcher) is forwarded
 * to the open socket.
 */

import type { FastifyInstance } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import { Redis } from 'ioredis';

import { getConfig } from '@/config/index.js';
import { getLogger } from '@/config/logger.js';
import { AppError, ErrorCode } from '@/config/errors.js';

const log = getLogger('ws');

interface WsClaims {
  user_id: string;
  exp: number;
}

async function verifyTokenFromQuery(
  app: FastifyInstance,
  token: string,
): Promise<WsClaims> {
  try {
    // Reuse the same jwt verifier registered on the app
    const decoded = (await app.jwt.verify(token, {
      algorithms: ['RS256'],
    })) as { sub: string; exp: number };
    if (!decoded.sub) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 'token missing sub claim');
    }
    return { user_id: decoded.sub, exp: decoded.exp };
  } catch {
    throw new AppError(ErrorCode.UNAUTHORIZED, 'invalid or expired token');
  }
}

export async function registerWebSocketRoutes(app: FastifyInstance): Promise<void> {
  // The @fastify/websocket plugin upgrades GET → WS.
  app.get('/v1/ws/notifications', { websocket: true }, async (socket: WebSocket, request) => {
    const token = (request.query as { token?: string }).token;
    if (!token) {
      socket.close(1008, 'missing token');
      return;
    }
    let claims: WsClaims;
    try {
      claims = await verifyTokenFromQuery(app, token);
    } catch {
      socket.close(1008, 'invalid token');
      return;
    }

    const cfg = getConfig();
    // Use a per-connection Redis client because subscribe blocks the connection
    const subscriber = new Redis({
      host: cfg.REDIS_HOST,
      port: cfg.REDIS_PORT,
      password: cfg.REDIS_PASSWORD || undefined,
      db: cfg.REDIS_DB,
      tls: cfg.REDIS_TLS ? {} : undefined,
      maxRetriesPerRequest: 1,
    });
    const channel = `notifications:user:${claims.user_id}`;

    let alive = true;
    const heartbeat = setInterval(() => {
      if (!alive) {
        try {
          socket.terminate();
        } catch {
          // ignore
        }
        return;
      }
      alive = false;
      try {
        socket.ping();
      } catch {
        // ignore
      }
    }, 30_000);

    socket.on('pong', () => {
      alive = true;
    });

    socket.on('close', async () => {
      clearInterval(heartbeat);
      try {
        await subscriber.unsubscribe(channel);
        await subscriber.quit();
      } catch (err) {
        log.warn({ err }, 'ws_cleanup_error');
      }
      log.info({ user_id: claims.user_id }, 'ws_disconnected');
    });

    socket.on('error', (err: unknown) => {
      log.warn({ err, user_id: claims.user_id }, 'ws_socket_error');
    });

    try {
      await subscriber.subscribe(channel);
      subscriber.on('message', (_chan, message) => {
        if (socket.readyState === socket.OPEN) {
          try {
            socket.send(message);
          } catch (err) {
            log.warn({ err }, 'ws_send_failed');
          }
        }
      });
    } catch (err) {
      log.error({ err, user_id: claims.user_id }, 'ws_subscribe_failed');
      socket.close(1011, 'subscribe failed');
      return;
    }

    log.info({ user_id: claims.user_id }, 'ws_connected');
    // Send a ready frame so clients know auth + subscribe succeeded
    try {
      socket.send(JSON.stringify({ type: 'ready' }));
    } catch {
      // ignore
    }
  });
}
