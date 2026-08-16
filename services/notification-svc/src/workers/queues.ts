/**
 * BullMQ queue definitions.
 */

import { Queue } from 'bullmq';
import { getBullMQConnection } from '@/clients/redis.js';
import { getLogger } from '@/config/logger.js';

const log = getLogger('queues');

export const BullQueues = {
  EmailDelivery: 'email-delivery',
  WebhookDelivery: 'webhook-delivery',
  DigestRollup: 'digest-rollup',
  TemplateRender: 'template-render',
  QuietHoursResume: 'quiet-hours-resume',
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
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { age: 86_400, count: 1000 },
      removeOnFail: { age: 7 * 86_400 },
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
