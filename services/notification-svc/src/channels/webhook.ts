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
import { lookup as dnsLookupCb } from 'node:dns';
import { promisify } from 'node:util';

import { AppError, ErrorCode } from '@/config/errors.js';
import { getLogger } from '@/config/logger.js';

const dnsLookup = promisify(dnsLookupCb) as (
  host: string,
  opts: { all: true; verbatim: boolean },
) => Promise<{ address: string; family: number }[]>;

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
 * Reject a webhook target that is not a public address.
 *
 * Three things were wrong with the previous version and all three mattered:
 *
 *   - the whole check ran only `if (cfg.isProduction)`, and this deployment
 *     runs APP_ENV=development, so it never ran at all;
 *   - it omitted 172.16.0.0/12, which is exactly where the Docker networks
 *     live -- the one range that actually matters here; and
 *   - it tested the hostname as text, so `postgres`, `minio` or any name
 *     resolving to an internal address sailed through, as did DNS rebinding.
 *
 * It now runs always, resolves the name, and judges the addresses it actually
 * resolves to. Deliveries still use `redirect: 'error'`, so a redirect cannot
 * be used to reach somewhere this check refused.
 */
function isPrivateIPv4(ip: string): boolean {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return false;
  const [a, b] = p as [number, number, number, number];
  if (a === 10) return true;                      // 10/8
  if (a === 127) return true;                     // loopback
  if (a === 0) return true;                       // "this" network
  if (a === 169 && b === 254) return true;        // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 -- Docker lives here
  if (a === 192 && b === 168) return true;        // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a >= 224) return true;                      // multicast + reserved
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const v = ip.toLowerCase().split('%')[0] ?? '';
  if (v === '::1' || v === '::') return true;
  if (v.startsWith('fc') || v.startsWith('fd')) return true; // unique local
  if (v.startsWith('fe80')) return true;                     // link-local
  if (v.startsWith('::ffff:')) return isPrivateIPv4(v.slice(7)); // v4-mapped
  return false;
}

export async function validateWebhookUrl(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError(ErrorCode.BAD_REQUEST, 'invalid URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new AppError(ErrorCode.BAD_REQUEST, 'webhook URL must be HTTPS');
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.')) {
    // A bare name with no dot is a container or a search-domain lookup, never a
    // public host -- `https://minio:9000` is the shape being refused here.
    throw new AppError(ErrorCode.BAD_REQUEST, 'webhook URL must be publicly routable');
  }

  let addresses: { address: string; family: number }[];
  try {
    addresses = await dnsLookup(host, { all: true, verbatim: true });
  } catch {
    throw new AppError(ErrorCode.BAD_REQUEST, 'webhook host does not resolve');
  }
  if (addresses.length === 0) {
    throw new AppError(ErrorCode.BAD_REQUEST, 'webhook host does not resolve');
  }
  // Every address, not just the first: a name that resolves to one public and
  // one internal address must not be accepted on the strength of the public one.
  for (const { address, family } of addresses) {
    const priv = family === 6 ? isPrivateIPv6(address) : isPrivateIPv4(address);
    if (priv) {
      throw new AppError(ErrorCode.BAD_REQUEST, 'webhook URL must be publicly routable');
    }
  }
}

