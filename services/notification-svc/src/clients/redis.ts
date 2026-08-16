/**
 * Redis client (ioredis) shared by webhook dedup, BullMQ, and rate-limit.
 */

import { Redis } from 'ioredis';

import { getConfig } from '@/config/index.js';
import { getLogger } from '@/config/logger.js';

const log = getLogger('redis');

let _client: Redis | null = null;

export function getRedis(): Redis {
  if (_client === null) {
    const cfg = getConfig();
    _client = new Redis({
      host: cfg.REDIS_HOST,
      port: cfg.REDIS_PORT,
      password: cfg.REDIS_PASSWORD || undefined,
      db: cfg.REDIS_DB,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
      tls: cfg.REDIS_TLS ? {} : undefined,
    });
    _client.on('error', (err) => {
      log.error({ err }, 'redis_error');
    });
    _client.on('connect', () => {
      log.info({ host: cfg.REDIS_HOST, db: cfg.REDIS_DB }, 'redis_connected');
    });
  }
  return _client;
}

export function getBullMQConnection() {
  const cfg = getConfig();
  return {
    host: cfg.REDIS_HOST,
    port: cfg.REDIS_PORT,
    password: cfg.REDIS_PASSWORD || undefined,
    db: cfg.REDIS_DB,
    maxRetriesPerRequest: null as unknown as number,
    enableReadyCheck: false,
    tls: cfg.REDIS_TLS ? {} : undefined,
  };
}

export async function closeRedis(): Promise<void> {
  if (_client !== null) {
    await _client.quit();
    _client = null;
  }
}
