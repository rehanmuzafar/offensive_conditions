import { describe, expect, it } from 'vitest';

import { AppError, ErrorCode } from '@/config/errors.js';

describe('AppError', () => {
  it('maps NOTIFICATION_NOT_FOUND to 404', () => {
    const err = new AppError(ErrorCode.NOTIFICATION_NOT_FOUND, 'gone');
    expect(err.statusCode).toBe(404);
  });

  it('maps USER_OPTED_OUT to 403', () => {
    const err = new AppError(ErrorCode.USER_OPTED_OUT, 'no');
    expect(err.statusCode).toBe(403);
  });

  it('maps PROVIDER_QUOTA_EXCEEDED to 429', () => {
    const err = new AppError(ErrorCode.PROVIDER_QUOTA_EXCEEDED, 'too many');
    expect(err.statusCode).toBe(429);
  });

  it('maps CHANNEL_UNAVAILABLE to 503', () => {
    const err = new AppError(ErrorCode.CHANNEL_UNAVAILABLE, 'down');
    expect(err.statusCode).toBe(503);
  });

  it('maps DELIVERY_FAILED to 502', () => {
    const err = new AppError(ErrorCode.DELIVERY_FAILED, 'provider error');
    expect(err.statusCode).toBe(502);
  });

  it('maps TEMPLATE_INVALID to 422', () => {
    const err = new AppError(ErrorCode.TEMPLATE_INVALID, 'bad MJML');
    expect(err.statusCode).toBe(422);
  });

  it('serializes to JSON shape', () => {
    const err = new AppError(ErrorCode.WEBHOOK_LIMIT_REACHED, 'max', { current: 10 });
    expect(err.toJSON()).toEqual({
      code: 'WEBHOOK_LIMIT_REACHED',
      message: 'max',
      details: { current: 10 },
    });
  });
});
