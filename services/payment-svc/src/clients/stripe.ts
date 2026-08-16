/**
 * Stripe SDK wrapper.
 *
 * We pin the API version explicitly (rather than relying on the account
 * default) so Stripe changes don't silently affect our handlers. Idempotency
 * keys are forwarded into Stripe's `idempotencyKey` request option on every
 * mutating call.
 */

import Stripe from 'stripe';

import { getConfig } from '@/config/index.js';
import { AppError, ErrorCode } from '@/config/errors.js';
import { getLogger } from '@/config/logger.js';

const log = getLogger('stripe');

let _client: Stripe | null = null;

export function getStripe(): Stripe {
  if (_client === null) {
    const cfg = getConfig();
    _client = new Stripe(cfg.STRIPE_SECRET_KEY, {
      apiVersion: cfg.STRIPE_API_VERSION as Stripe.LatestApiVersion,
      maxNetworkRetries: 2,
      timeout: 10_000,
      telemetry: false,
      appInfo: {
        name: cfg.APP_NAME,
        version: cfg.APP_VERSION,
        url: 'https://offensiveconditions.org',
      },
    });
    log.info({ api_version: cfg.STRIPE_API_VERSION }, 'stripe_client_initialized');
  }
  return _client;
}

/**
 * Wrap a Stripe call and convert their error envelope into our `AppError`.
 */
export async function withStripe<T>(
  fn: (client: Stripe) => Promise<T>,
  context: { idempotencyKey?: string; description: string },
): Promise<T> {
  const client = getStripe();
  try {
    return await fn(client);
  } catch (err) {
    if (err instanceof Stripe.errors.StripeError) {
      log.warn(
        {
          stripe_type: err.type,
          stripe_code: err.code,
          stripe_request_id: err.requestId,
          context: context.description,
        },
        'stripe_error',
      );

      // Idempotency conflict: same key with different params
      if (err.type === 'StripeIdempotencyError') {
        throw new AppError(
          ErrorCode.IDEMPOTENCY_KEY_REUSED,
          'idempotency key reused with different parameters',
          { stripe_code: err.code, request_id: err.requestId },
        );
      }
      // Card declined / payment failed
      if (err.type === 'StripeCardError') {
        throw new AppError(
          ErrorCode.STRIPE_ERROR,
          err.message,
          { stripe_code: err.code, decline_code: err.decline_code },
        );
      }
      throw new AppError(ErrorCode.STRIPE_ERROR, err.message, {
        stripe_type: err.type,
        stripe_code: err.code,
        request_id: err.requestId,
      });
    }
    log.error({ err, context: context.description }, 'stripe_unknown_error');
    throw err;
  }
}
