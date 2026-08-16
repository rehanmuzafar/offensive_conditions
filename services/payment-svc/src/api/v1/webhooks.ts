/**
 * Stripe webhook endpoint.
 *
 * Critical: this route reads the raw body (not parsed JSON) because Stripe
 * computes the signature over the literal bytes. We register a per-route
 * content type parser that buffers the body, then the handler verifies +
 * dispatches.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';

import { AppError, ErrorCode } from '@/config/errors.js';
import { getLogger } from '@/config/logger.js';
import { BullQueues, getQueue } from '@/workers/queues.js';
import {
  dispatch,
  isDuplicate,
  markProcessed,
  persistEvent,
  verifySignature,
} from '@/services/webhooks.js';

const log = getLogger('webhook-route');

export async function registerWebhookRoutes(app: FastifyInstance): Promise<void> {
  // Register a raw-body content parser for the webhook route only.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    function (req, body, done) {
      // Only apply to webhook route; everything else uses the default JSON parser.
      if (!req.url.startsWith('/webhooks/stripe')) {
        try {
          const parsed = body.length ? JSON.parse(body.toString('utf-8')) : {};
          done(null, parsed);
        } catch (err) {
          done(err as Error);
        }
        return;
      }
      // Keep raw buffer; signature verification reads it directly.
      done(null, body);
    },
  );

  app.post(
    '/webhooks/stripe',
    {
      // No JSON schema — body is a Buffer here, validation happens via signature
      bodyLimit: 1024 * 1024 * 2, // 2 MiB
    },
    async (request: FastifyRequest, reply) => {
      const signature = request.headers['stripe-signature'];
      if (!signature || typeof signature !== 'string') {
        throw new AppError(ErrorCode.WEBHOOK_SIGNATURE_INVALID, 'missing stripe-signature header');
      }

      const rawBody = request.body as Buffer;
      if (!Buffer.isBuffer(rawBody)) {
        throw new AppError(ErrorCode.BAD_REQUEST, 'request body must be raw bytes');
      }

      const event = verifySignature(rawBody, signature);

      // Dedupe via Redis
      if (await isDuplicate(event.id)) {
        log.info({ event_id: event.id }, 'webhook_duplicate_ignored');
        return reply.code(200).send({ received: true, duplicate: true });
      }

      // Persist + dispatch
      const webhookRowId = await persistEvent(event);
      try {
        // Heavy events go to BullMQ; light ones we handle inline
        const heavy = isHeavyEvent(event.type);
        if (heavy) {
          await getQueue(BullQueues.WebhookProcessing).add(
            event.type,
            { event_id: event.id, webhook_row_id: webhookRowId, event },
            { jobId: event.id, removeOnComplete: 1000, removeOnFail: 5000 },
          );
        } else {
          await dispatch(event);
          await markProcessed(webhookRowId);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await markProcessed(webhookRowId, message);
        log.error({ err, event_id: event.id }, 'webhook_processing_failed');
        // Return 500 so Stripe retries
        throw err;
      }

      return reply.code(200).send({ received: true });
    },
  );
}

function isHeavyEvent(eventType: string): boolean {
  // Events whose handlers do significant Stripe API roundtrips
  // (invoice PDF fetch, subscription deep traversal) go async.
  return [
    'invoice.finalized',
    'invoice.paid',
    'invoice.payment_failed',
    'customer.subscription.created',
    'customer.subscription.updated',
    'charge.refunded',
  ].includes(eventType);
}
