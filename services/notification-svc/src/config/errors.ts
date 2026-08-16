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

  // Notification-specific
  TEMPLATE_NOT_FOUND = 'TEMPLATE_NOT_FOUND',
  TEMPLATE_INVALID = 'TEMPLATE_INVALID',
  NOTIFICATION_NOT_FOUND = 'NOTIFICATION_NOT_FOUND',
  WEBHOOK_NOT_FOUND = 'WEBHOOK_NOT_FOUND',
  WEBHOOK_LIMIT_REACHED = 'WEBHOOK_LIMIT_REACHED',
  CHANNEL_UNAVAILABLE = 'CHANNEL_UNAVAILABLE',
  USER_OPTED_OUT = 'USER_OPTED_OUT',
  DELIVERY_FAILED = 'DELIVERY_FAILED',
  PROVIDER_QUOTA_EXCEEDED = 'PROVIDER_QUOTA_EXCEEDED',
  EVENT_DUPLICATE = 'EVENT_DUPLICATE',
  PREFERENCE_INVALID = 'PREFERENCE_INVALID',
}

const STATUS_MAP: Record<ErrorCode, number> = {
  [ErrorCode.INTERNAL]: 500,
  [ErrorCode.BAD_REQUEST]: 400,
  [ErrorCode.VALIDATION]: 400,
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.TEMPLATE_NOT_FOUND]: 404,
  [ErrorCode.NOTIFICATION_NOT_FOUND]: 404,
  [ErrorCode.WEBHOOK_NOT_FOUND]: 404,
  [ErrorCode.CONFLICT]: 409,
  [ErrorCode.EVENT_DUPLICATE]: 409,
  [ErrorCode.WEBHOOK_LIMIT_REACHED]: 409,
  [ErrorCode.TEMPLATE_INVALID]: 422,
  [ErrorCode.PREFERENCE_INVALID]: 422,
  [ErrorCode.CHANNEL_UNAVAILABLE]: 503,
  [ErrorCode.USER_OPTED_OUT]: 403,
  [ErrorCode.DELIVERY_FAILED]: 502,
  [ErrorCode.PROVIDER_QUOTA_EXCEEDED]: 429,
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
    if (this.details) out.details = this.details;
    return out;
  }
}
