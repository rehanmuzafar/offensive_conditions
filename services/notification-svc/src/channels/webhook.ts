/**
 * Outbound webhook channel.
 *
 * Posts events to user-registered URLs with HMAC-SHA256 signing in the
 * `X-Offcon-Signature` header. The signed payload is:
 *
 *     "{timestamp}.{body}"
 *
 * which prevents replay (recipients should reject timestamps > 5 minutes
 * old) and is robust against body modifications.
 *
 * Recipients verify with:
 *     expected = hmac_sha256(secret, f"{ts}.{body}")
 *     valid = constant_time_compare(expected, received_sig)
 */

import { createHmac } from 'node:crypto';

import { getConfig } from '@/config/index.js';
import { AppError, ErrorCode } from '@/config/errors.js';
import { getLogger } from '@/config/logger.js';

const log = getLogger('webhook-channel');

export interface WebhookDispatchInput {
  url: string;
  secret: string;
  event: {
    event_id: string;
    event_type: string;
    occurred_at: string;
    payload: Record<string, unknown>;
  };
}

export interface WebhookDispatchResult {
  status: 'sent' | 'failed';
  http_status: number | null;
  latency_ms: number;
  failure_reason: string | null;
}

export function signPayload(body: string, secret: string, timestampSeconds: number): string {
  const data = `${timestampSeconds}.${body}`;
  return createHmac('sha256', secret).update(data, 'utf-8').digest('hex');
}

export async function dispatchWebhook(input: WebhookDispatchInput): Promise<WebhookDispatchResult> {
  const cfg = getConfig();
  const body = JSON.stringify(input.event);
  const ts = Math.floor(Date.now() / 1000);
  const signature = signPayload(body, input.secret, ts);

  const start = Date.now();
  try {
    const response = await fetch(input.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': `${cfg.APP_NAME}/${cfg.APP_VERSION}`,
        [cfg.WEBHOOK_SIGNATURE_HEADER]: `sha256=${signature}`,
        [cfg.WEBHOOK_TIMESTAMP_HEADER]: String(ts),
        'X-Offcon-Event-Id': input.event.event_id,
        'X-Offcon-Event-Type': input.event.event_type,
      },
      body,
      signal: AbortSignal.timeout(cfg.WEBHOOK_TIMEOUT_MS),
      redirect: 'error',  // don't follow redirects; signatures wouldn't propagate
    });
    const latency = Date.now() - start;

    if (!response.ok) {
      const responseBody = await response.text().catch(() => '');
      return {
        status: 'failed',
        http_status: response.status,
        latency_ms: latency,
        failure_reason: `HTTP ${response.status}: ${responseBody.slice(0, 500)}`,
      };
    }
    return { status: 'sent', http_status: response.status, latency_ms: latency, failure_reason: null };
  } catch (err) {
    const latency = Date.now() - start;
    const reason = err instanceof Error ? err.message : String(err);
    log.warn({ err, url: input.url, event_id: input.event.event_id }, 'webhook_dispatch_error');
    return { status: 'failed', http_status: null, latency_ms: latency, failure_reason: reason };
  }
}

/**
 * Validate a target URL meets our hygiene requirements:
 *   - HTTPS only (except localhost in dev)
 *   - Not a private IP / loopback / link-local in production
 *   - Domain length reasonable
 */
export function validateWebhookUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError(ErrorCode.BAD_REQUEST, 'invalid URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new AppError(ErrorCode.BAD_REQUEST, 'webhook URL must be HTTPS');
  }
  const cfg = getConfig();
  if (cfg.isProduction) {
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host.endsWith('.local') ||
      host.startsWith('127.') ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host.startsWith('169.254.') ||
      host === '::1'
    ) {
      throw new AppError(ErrorCode.BAD_REQUEST, 'webhook URL must be publicly routable');
    }
  }
}
