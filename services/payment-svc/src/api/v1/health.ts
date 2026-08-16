/**
 * Health probes for Kubernetes liveness / readiness.
 */

import type { FastifyInstance } from 'fastify';

import { getConfig } from '@/config/index.js';
import { getRedis } from '@/clients/redis.js';
import { getPool } from '@/db/pool.js';

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/livez', async () => {
    const cfg = getConfig();
    return { status: 'ok', version: cfg.APP_VERSION };
  });

  app.get('/readyz', async (_request, reply) => {
    const checks: Record<string, string> = {};
    let overall = true;
    try {
      await getPool().query('SELECT 1');
      checks.postgres = 'ok';
    } catch (err) {
      checks.postgres = `down: ${(err as Error).message}`;
      overall = false;
    }
    try {
      await getRedis().ping();
      checks.redis = 'ok';
    } catch (err) {
      checks.redis = `down: ${(err as Error).message}`;
      overall = false;
    }
    if (!overall) {
      reply.code(503);
    }
    return { ok: overall, checks };
  });
}
