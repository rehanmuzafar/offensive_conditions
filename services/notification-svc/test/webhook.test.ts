import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';

import { signPayload } from '@/channels/webhook.js';

describe('webhook signPayload', () => {
  it('returns hex HMAC-SHA256 of ts.body', () => {
    const body = '{"event_id":"evt_1","payload":{"hello":"world"}}';
    const secret = 'whsk_test_secret';
    const ts = 1_700_000_000;
    const sig = signPayload(body, secret, ts);

    const expected = createHmac('sha256', secret)
      .update(`${ts}.${body}`, 'utf-8')
      .digest('hex');

    expect(sig).toBe(expected);
    expect(sig).toMatch(/^[a-f0-9]{64}$/);
  });

  it('signatures differ for different timestamps', () => {
    const body = 'payload';
    const secret = 'whsk_test_secret';
    expect(signPayload(body, secret, 100)).not.toBe(signPayload(body, secret, 101));
  });

  it('signatures differ for different secrets', () => {
    const body = 'payload';
    const ts = 100;
    expect(signPayload(body, 'a', ts)).not.toBe(signPayload(body, 'b', ts));
  });
});
