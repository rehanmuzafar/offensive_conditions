/**
 * Request context: X-Request-ID propagation + structured error responses.
 */

import { randomUUID } from 'node:crypto';

import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

import { AppError, ErrorCode } from '@/config/errors.js';
import { getLogger } from '@/config/logger.js';

declare module 'fastify' {
  interface FastifyRequest {
    requestId: string;
  }
}

export function registerRequestContext(app: FastifyInstance): void {
  const log = getLogger('http');

  app.addHook('onRequest', async (request, reply) => {
    const incoming = request.headers['x-request-id'];
    const rid = (typeof incoming === 'string' && incoming) || randomUUID();
    request.requestId = rid;
    reply.header('x-request-id', rid);
  });

  app.addHook('onResponse', async (request, reply) => {
    const status = reply.statusCode;
    const duration = reply.elapsedTime;
    const meta = {
      method: request.method,
      path: request.url,
      status,
      duration_ms: Math.round(duration),
      request_id: request.requestId,
    };
    if (status >= 500) log.error(meta, 'http_request');
    else if (status >= 400) log.warn(meta, 'http_request');
    else log.info(meta, 'http_request');
  });
}

export function registerErrorHandler(app: FastifyInstance): void {
  const log = getLogger('errors');

  app.setErrorHandler(async (err: FastifyError | AppError | ZodError, request: FastifyRequest, reply: FastifyReply) => {
    if (err instanceof AppError) {
      log.warn({ code: err.code, msg: err.message, path: request.url }, 'app_error');
      return reply.status(err.statusCode).send({ error: err.toJSON() });
    }
    if (err instanceof ZodError) {
      log.warn({ issues: err.issues, path: request.url }, 'validation_error');
      return reply.status(400).send({
        error: {
          code: ErrorCode.VALIDATION,
          message: 'request validation failed',
          details: { issues: err.issues },
        },
      });
    }
    // Fastify validation error (from schema)
    const fastErr = err as FastifyError;
    if (fastErr.validation) {
      log.warn({ validation: fastErr.validation, path: request.url }, 'schema_validation_error');
      return reply.status(400).send({
        error: {
          code: ErrorCode.VALIDATION,
          message: fastErr.message,
          details: { issues: fastErr.validation },
        },
      });
    }
    if (fastErr.statusCode && fastErr.statusCode < 500) {
      return reply.status(fastErr.statusCode).send({
        error: { code: ErrorCode.BAD_REQUEST, message: fastErr.message },
      });
    }
    log.error({ err, path: request.url, request_id: request.requestId }, 'unhandled_error');
    return reply.status(500).send({
      error: { code: ErrorCode.INTERNAL, message: 'internal server error' },
    });
  });

  app.setNotFoundHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(404).send({
      error: { code: ErrorCode.NOT_FOUND, message: `route ${request.method} ${request.url} not found` },
    });
  });
}
