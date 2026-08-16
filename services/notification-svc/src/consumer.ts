/**
 * Kafka consumer entrypoint.
 *
 * Long-running process that subscribes to all domain-event topics and routes
 * envelopes through the dispatcher. Designed to scale horizontally — Kafka
 * partitions are distributed across consumer-group members automatically.
 */

import { loadConfig } from '@/config/index.js';
import { getLogger } from '@/config/logger.js';
import { closePool, initPool } from '@/db/pool.js';
import { closeRedis, getRedis } from '@/clients/redis.js';
import { startConsumer, stopConsumer } from '@/clients/kafka.js';
import { closeAllQueues } from '@/workers/queues.js';
import { handleMessage } from '@/consumers/handler.js';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const log = getLogger('consumer-main');
  log.info({ env: cfg.APP_ENV, version: cfg.APP_VERSION }, 'starting_notification_consumer');

  initPool();
  getRedis();
  await startConsumer(handleMessage);

  log.info('consumer_running');

  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal }, 'consumer_shutdown_received');
    try {
      await stopConsumer();
      await closeAllQueues();
      await closeRedis();
      await closePool();
      log.info('consumer_shutdown_complete');
      process.exit(0);
    } catch (err) {
      log.error({ err }, 'consumer_shutdown_failed');
      process.exit(1);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => {
    log.fatal({ err }, 'consumer_uncaught_exception');
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    log.fatal({ reason }, 'consumer_unhandled_rejection');
    process.exit(1);
  });
}

void main();
