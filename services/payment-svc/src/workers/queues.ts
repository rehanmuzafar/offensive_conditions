/**
 * BullMQ queue definitions + factory.
 *
 * Queues use the shared Redis client. Workers live in `src/worker.ts` as
 * a separate process so they can scale independently of the HTTP server.
 */

import { Queue } from 'bullmq';
import { getBullMQConnection } from '@/clients/redis.js';
import { getLogger } from '@/config/logger.js';

const log = getLogger('queues');

export const BullQueues = {
  WebhookProcessing: 'webhook-processing',
  RefundProcessing: 'refund-processing',
  InvoicePdfGeneration: 'invoice-pdf-generation',
  SubscriptionCleanup: 'subscription-cleanup',
  DunningRetry: 'dunning-retry',
} as const;

export type QueueName = (typeof BullQueues)[keyof typeof BullQueues];

const queueCache = new Map<QueueName, Queue>();

function connection() {
  return { connection: getBullMQConnection() };
}

export function getQueue(name: QueueName): Queue {
  const existing = queueCache.get(name);
  if (existing) return existing;
  const queue = new Queue(name, {
    ...connection(),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { age: 86400, count: 1000 },
      removeOnFail: { age: 7 * 86400 },
    },
  });
  queueCache.set(name, queue);
  log.info({ queue: name }, 'queue_registered');
  return queue;
}

export async function closeAllQueues(): Promise<void> {
  for (const [name, queue] of queueCache) {
    try {
      await queue.close();
      log.info({ queue: name }, 'queue_closed');
    } catch (err) {
      log.warn({ err, queue: name }, 'queue_close_failed');
    }
  }
  queueCache.clear();
}
