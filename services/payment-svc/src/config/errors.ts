/**
 * Typed application errors mapped to HTTP status codes.
 */

export enum ErrorCode {
  // Generic
  INTERNAL = 'INTERNAL_ERROR',
  BAD_REQUEST = 'BAD_REQUEST',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  VALIDATION = 'VALIDATION_FAILED',
  RATE_LIMITED = 'RATE_LIMITED',

  // Payment-specific
  PLAN_NOT_FOUND = 'PLAN_NOT_FOUND',
  PLAN_INACTIVE = 'PLAN_INACTIVE',
  SUBSCRIPTION_NOT_FOUND = 'SUBSCRIPTION_NOT_FOUND',
  SUBSCRIPTION_ALREADY_ACTIVE = 'SUBSCRIPTION_ALREADY_ACTIVE',
  SUBSCRIPTION_NOT_ACTIVE = 'SUBSCRIPTION_NOT_ACTIVE',
  SUBSCRIPTION_ALREADY_CANCELED = 'SUBSCRIPTION_ALREADY_CANCELED',
  INVOICE_NOT_FOUND = 'INVOICE_NOT_FOUND',
  CUSTOMER_NOT_FOUND = 'CUSTOMER_NOT_FOUND',
  PAYMENT_METHOD_NOT_FOUND = 'PAYMENT_METHOD_NOT_FOUND',
  COUPON_NOT_FOUND = 'COUPON_NOT_FOUND',
  COUPON_EXPIRED = 'COUPON_EXPIRED',
  COUPON_LIMIT_REACHED = 'COUPON_LIMIT_REACHED',
  COUPON_ALREADY_REDEEMED = 'COUPON_ALREADY_REDEEMED',
  REFUND_AMOUNT_TOO_HIGH = 'REFUND_AMOUNT_TOO_HIGH',
  STRIPE_ERROR = 'STRIPE_ERROR',
  WEBHOOK_SIGNATURE_INVALID = 'WEBHOOK_SIGNATURE_INVALID',
  WEBHOOK_DUPLICATE = 'WEBHOOK_DUPLICATE',
  IDEMPOTENCY_KEY_REUSED = 'IDEMPOTENCY_KEY_REUSED',
  RISK_BLOCKED = 'RISK_BLOCKED',
}

const STATUS_MAP: Record<ErrorCode, number> = {
  [ErrorCode.INTERNAL]: 500,
  [ErrorCode.BAD_REQUEST]: 400,
  [ErrorCode.VALIDATION]: 400,
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.PLAN_NOT_FOUND]: 404,
  [ErrorCode.SUBSCRIPTION_NOT_FOUND]: 404,
  [ErrorCode.INVOICE_NOT_FOUND]: 404,
  [ErrorCode.CUSTOMER_NOT_FOUND]: 404,
  [ErrorCode.PAYMENT_METHOD_NOT_FOUND]: 404,
  [ErrorCode.COUPON_NOT_FOUND]: 404,
  [ErrorCode.CONFLICT]: 409,
  [ErrorCode.PLAN_INACTIVE]: 409,
  [ErrorCode.SUBSCRIPTION_ALREADY_ACTIVE]: 409,
  [ErrorCode.SUBSCRIPTION_NOT_ACTIVE]: 409,
  [ErrorCode.SUBSCRIPTION_ALREADY_CANCELED]: 409,
  [ErrorCode.COUPON_EXPIRED]: 409,
  [ErrorCode.COUPON_LIMIT_REACHED]: 409,
  [ErrorCode.COUPON_ALREADY_REDEEMED]: 409,
  [ErrorCode.IDEMPOTENCY_KEY_REUSED]: 409,
  [ErrorCode.WEBHOOK_DUPLICATE]: 409,
  [ErrorCode.REFUND_AMOUNT_TOO_HIGH]: 422,
  [ErrorCode.WEBHOOK_SIGNATURE_INVALID]: 400,
  [ErrorCode.STRIPE_ERROR]: 502,
  [ErrorCode.RISK_BLOCKED]: 403,
  [ErrorCode.RATE_LIMITED]: 429,
};

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = STATUS_MAP[code] ?? 500;
    this.details = details;
  }

  toJSON(): { code: string; message: string; details?: Record<string, unknown> } {
    const out: { code: string; message: string; details?: Record<string, unknown> } = {
      code: this.code,
      message: this.message,
    };
    if (this.details) {
      out.details = this.details;
    }
    return out;
  }
}
