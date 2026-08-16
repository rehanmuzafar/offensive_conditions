/**
 * BullMQ worker entrypoint.
 *
 * Runs email + webhook + template + digest workers.
 */

import { loadConfig } from '@/config/index.js';
import { getLogger } from '@/config/logger.js';
import { closePool, initPool } from '@/db/pool.js';
import { closeRedis, getRedis } from '@/clients/redis.js';
import { closeAllQueues } from '@/workers/queues.js';
import {
  createDigestWorker,
  createEmailWorker,
  createTemplateRenderWorker,
  createWebhookWorker,
} from '@/workers/handlers.js';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const log = getLogger('worker');
  log.info({ env: cfg.APP_ENV, version: cfg.APP_VERSION }, 'starting_notification_worker');

  initPool();
  getRedis();

  const workers = [
    createEmailWorker(),
    createWebhookWorker(),
    createTemplateRenderWorker(),
    createDigestWorker(),
  ];

  for (const w of workers) {
    w.on('completed', (job) => log.info({ job_id: job.id, queue: w.name }, 'job_completed'));
    w.on('failed', (job, err) =>
      log.error({ job_id: job?.id, queue: w.name, err }, 'job_failed'),
    );
    w.on('error', (err) => log.error({ queue: w.name, err }, 'worker_error'));
  }
  log.info({ workers: workers.length }, 'workers_started');

  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal }, 'worker_shutdown_received');
    try {
      await Promise.all(workers.map((w) => w.close()));
      await closeAllQueues();
      await closeRedis();
      await closePool();
      log.info('worker_shutdown_complete');
      process.exit(0);
    } catch (err) {
      log.error({ err }, 'worker_shutdown_failed');
      process.exit(1);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main();
