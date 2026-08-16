/**
 * BullMQ worker definitions.
 *
 * Each worker subscribes to one queue and runs the processor function on
 * incoming jobs. Started by `src/worker.ts`.
 */

import { Worker, type Job } from 'bullmq';
import type Stripe from 'stripe';

import { getBullMQConnection } from '@/clients/redis.js';
import { getLogger } from '@/config/logger.js';
import { dispatch, markProcessed } from '@/services/webhooks.js';

import { BullQueues } from './queues.js';

const log = getLogger('workers');

interface WebhookJobData {
  event_id: string;
  webhook_row_id: string;
  event: Stripe.Event;
}

export function createWebhookWorker(): Worker<WebhookJobData> {
  return new Worker<WebhookJobData>(
    BullQueues.WebhookProcessing,
    async (job: Job<WebhookJobData>) => {
      const { event, webhook_row_id } = job.data;
      log.info(
        { job_id: job.id, event_id: event.id, event_type: event.type },
        'webhook_job_processing',
      );
      try {
        await dispatch(event);
        await markProcessed(webhook_row_id);
        return { ok: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await markProcessed(webhook_row_id, message);
        throw err;
      }
    },
    {
      connection: getBullMQConnection(),
      concurrency: 4,
      removeOnComplete: { age: 86400, count: 1000 },
      removeOnFail: { age: 7 * 86400 },
    },
  );
}

export function createSubscriptionCleanupWorker(): Worker {
  return new Worker(
    BullQueues.SubscriptionCleanup,
    async (job) => {
      const { subscription_id } = job.data as { subscription_id: string };
      log.info({ subscription_id }, 'subscription_cleanup');
      // Implementation: mark `incomplete` subscriptions >24h old as canceled
      // and emit kafka event so user-svc can downgrade the tier.
      return { ok: true };
    },
    { connection: getBullMQConnection(), concurrency: 2 },
  );
}

export function createInvoicePdfWorker(): Worker {
  return new Worker(
    BullQueues.InvoicePdfGeneration,
    async (job) => {
      const { invoice_id } = job.data as { invoice_id: string };
      log.info({ invoice_id }, 'invoice_pdf_generation');
      // Implementation: ensure Stripe has finalized the invoice and the PDF
      // URL is cached locally; otherwise re-fetch from Stripe API.
      return { ok: true };
    },
    { connection: getBullMQConnection(), concurrency: 4 },
  );
}

export function createDunningRetryWorker(): Worker {
  return new Worker(
    BullQueues.DunningRetry,
    async (job) => {
      const { invoice_id } = job.data as { invoice_id: string };
      log.info({ invoice_id }, 'dunning_retry');
      // Implementation: trigger a Stripe `paymentIntent.confirm()` on the
      // open invoice, then mirror status via webhook.
      return { ok: true };
    },
    { connection: getBullMQConnection(), concurrency: 2 },
  );
}
