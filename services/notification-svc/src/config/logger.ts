/**
 * Structured logging with Pino.
 *
 * Default mode is JSON for production. Local dev uses `pino-pretty` for
 * readable colored output.
 */

import pino, { type Logger } from 'pino';

import { getConfig } from '@/config/index.js';

let _logger: Logger | null = null;

export function getLogger(component?: string): Logger {
  if (_logger === null) {
    const cfg = getConfig();
    const isPretty = cfg.LOG_FORMAT === 'pretty';
    _logger = pino({
      level: cfg.LOG_LEVEL,
      base: { service: cfg.APP_NAME, version: cfg.APP_VERSION, env: cfg.APP_ENV },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: (label) => ({ level: label }),
      },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          '*.password',
          '*.token',
          '*.client_secret',
          '*.api_key',
          '*.card.*',
        ],
        censor: '***REDACTED***',
      },
      ...(isPretty
        ? {
            transport: {
              target: 'pino-pretty',
              options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
            },
          }
        : {}),
    });
  }
  return component ? _logger.child({ component }) : _logger;
}

export function resetLogger(): void {
  _logger = null;
}
