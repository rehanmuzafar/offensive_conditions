import { describe, expect, it, beforeEach } from 'vitest';

import { AppError, ErrorCode } from '@/config/errors.js';

describe('AppError', () => {
  it('maps NOT_FOUND to status 404', () => {
    const err = new AppError(ErrorCode.NOT_FOUND, 'gone');
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
  });

  it('maps RATE_LIMITED to 429', () => {
    const err = new AppError(ErrorCode.RATE_LIMITED, 'slow down');
    expect(err.statusCode).toBe(429);
  });

  it('maps REFUND_AMOUNT_TOO_HIGH to 422', () => {
    const err = new AppError(ErrorCode.REFUND_AMOUNT_TOO_HIGH, 'too much');
    expect(err.statusCode).toBe(422);
  });

  it('maps SUBSCRIPTION_NOT_ACTIVE to 409', () => {
    const err = new AppError(ErrorCode.SUBSCRIPTION_NOT_ACTIVE, 'none');
    expect(err.statusCode).toBe(409);
  });

  it('serializes to a clean JSON shape', () => {
    const err = new AppError(ErrorCode.PLAN_NOT_FOUND, 'gone', { plan_code: 'vip_monthly' });
    expect(err.toJSON()).toEqual({
      code: 'PLAN_NOT_FOUND',
      message: 'gone',
      details: { plan_code: 'vip_monthly' },
    });
  });

  it('omits details when none provided', () => {
    const err = new AppError(ErrorCode.UNAUTHORIZED, 'no token');
    expect(err.toJSON()).toEqual({ code: 'UNAUTHORIZED', message: 'no token' });
  });

  it('defaults to 500 for INTERNAL', () => {
    const err = new AppError(ErrorCode.INTERNAL, 'oops');
    expect(err.statusCode).toBe(500);
  });
});

describe('Config loader', () => {
  beforeEach(async () => {
    const mod = await import('@/config/index.js');
    mod.resetConfig();
  });

  it('uses default values when env is empty', async () => {
    const prev = { ...process.env };
    try {
      delete process.env.DB_HOST;
      delete process.env.STRIPE_SECRET_KEY;
      const { loadConfig } = await import('@/config/index.js');
      const cfg = loadConfig();
      expect(cfg.HTTP_PORT).toBe(8007);
      expect(cfg.GRPC_PORT).toBe(9007);
      expect(cfg.REDIS_DB).toBe(6);
      expect(cfg.STRIPE_SECRET_KEY).toMatch(/^sk_/);
    } finally {
      Object.assign(process.env, prev);
    }
  });
});
