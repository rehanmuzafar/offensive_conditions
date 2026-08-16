/**
 * JWT validation + Claims extraction.
 *
 * The auth service signs JWTs with RS256; we verify the signature using a
 * public key loaded from disk. Tokens are expected via `Authorization: Bearer`.
 */

import { readFileSync } from 'node:fs';

import type { FastifyReply, FastifyRequest } from 'fastify';
import jwt from '@fastify/jwt';
import type { FastifyInstance } from 'fastify';

import { getConfig } from '@/config/index.js';
import { AppError, ErrorCode } from '@/config/errors.js';
import { getLogger } from '@/config/logger.js';

const log = getLogger('auth');

export interface Claims {
  user_id: string;
  session_id: string;
  tier: string;
  roles: string[];
  is_admin: boolean;
  is_support: boolean;
  exp: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    claims?: Claims;
  }
}

export async function registerAuth(app: FastifyInstance): Promise<void> {
  const cfg = getConfig();
  const publicKey = readFileSync(cfg.AUTH_JWT_PUBLIC_KEY_PATH, 'utf-8');

  await app.register(jwt, {
    secret: { public: publicKey, private: '' as never },
    sign: { algorithm: 'RS256' },
    verify: { algorithms: ['RS256'] },
    decoratorName: 'jwtAuth',
  });

  app.decorate(
    'requireAuth',
    async function (request: FastifyRequest, _reply: FastifyReply): Promise<void> {
      const authz = request.headers.authorization;
      if (!authz) {
        throw new AppError(ErrorCode.UNAUTHORIZED, 'missing authorization header');
      }
      const [scheme, token] = authz.split(' ');
      if (scheme?.toLowerCase() !== 'bearer' || !token) {
        throw new AppError(ErrorCode.UNAUTHORIZED, 'invalid authorization header');
      }
      try {
        type DecodedJwt = { sub: string; sid?: string; tier?: string; roles?: string[]; exp?: number };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const decoded = (await (app.jwt as any).verify(token)) as DecodedJwt;

        if (!decoded.sub) {
          throw new AppError(ErrorCode.UNAUTHORIZED, 'token missing sub claim');
        }
        const roles = decoded.roles ?? [];
        request.claims = {
          user_id: decoded.sub,
          session_id: decoded.sid ?? '',
          tier: decoded.tier ?? 'free',
          roles,
          is_admin: roles.includes('admin'),
          is_support: roles.includes('admin') || roles.includes('support'),
          exp: decoded.exp ?? 0,
        };
      } catch (err) {
        if (err instanceof AppError) throw err;
        log.warn({ err }, 'jwt_verify_failed');
        throw new AppError(ErrorCode.UNAUTHORIZED, 'invalid or expired token');
      }
    },
  );

  app.decorate(
    'requireAdmin',
    async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
      await (app as unknown as { requireAuth: (req: FastifyRequest, rep: FastifyReply) => Promise<void> }).requireAuth(
        request,
        reply,
      );
      if (!request.claims?.is_admin) {
        throw new AppError(ErrorCode.FORBIDDEN, 'admin role required');
      }
    },
  );
}

declare module 'fastify' {
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest, rep: FastifyReply) => Promise<void>;
    requireAdmin: (req: FastifyRequest, rep: FastifyReply) => Promise<void>;
  }
}
