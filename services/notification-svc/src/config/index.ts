/**
 * Application configuration loaded from environment variables.
 */

import { z } from 'zod';

// z.coerce.boolean() treats any non-empty string as true — so "false" → true.
// boolFromEnv parses common truthy strings correctly instead.
const boolFromEnv = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v === '') return def;
      return ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
    });


const EnvSchema = z.object({
  // App
  APP_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  APP_NAME: z.string().default('notification-svc'),
  APP_VERSION: z.string().default('0.1.0'),

  // HTTP
  HTTP_PORT: z.coerce.number().int().positive().default(8008),
  HTTP_HOST: z.string().default('0.0.0.0'),
  HTTP_CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((v) => v.split(',').map((s) => s.trim())),

  // gRPC
  GRPC_PORT: z.coerce.number().int().positive().default(9008),

  // Database
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_NAME: z.string().default('offcon'),
  DB_USER: z.string().default('notification_svc'),
  DB_PASSWORD: z.string().default(''),
  DB_SSL: boolFromEnv(false),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),

  // Redis
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().default(''),
  REDIS_DB: z.coerce.number().int().min(0).max(15).default(7),
  REDIS_TLS: boolFromEnv(false),

  // Auth
  AUTH_JWT_PUBLIC_KEY_PATH: z.string().default('./testdata/jwt.pub'),
  AUTH_JWT_ISSUER: z.string().default('https://auth.offensiveconditions.org'),
  AUTH_JWT_AUDIENCE: z.string().default('offcon-api'),

  // Email providers
  EMAIL_FROM_ADDRESS: z.string().email().default('noreply@offensiveconditions.org'),
  EMAIL_FROM_NAME: z.string().default('Offensive Conditions'),
  EMAIL_REPLY_TO: z.string().email().optional(),
  EMAIL_PROVIDER_PRIMARY: z.enum(['resend', 'sendgrid', 'mock']).default('resend'),
  EMAIL_PROVIDER_FAILOVER: z.enum(['resend', 'sendgrid', 'mock', 'none']).default('none'),

  RESEND_API_KEY: z.string().default(''),
  SENDGRID_API_KEY: z.string().default(''),

  // Kafka
  KAFKA_BROKERS: z
    .string()
    .default('localhost:9092')
    .transform((v) => v.split(',').map((s) => s.trim())),
  KAFKA_CONSUMER_GROUP: z.string().default('notification-svc'),
  KAFKA_USE_TLS: boolFromEnv(false),
  KAFKA_USERNAME: z.string().optional(),
  KAFKA_PASSWORD: z.string().optional(),
  KAFKA_TOPIC_AUTH_EVENTS: z.string().default('auth.events'),
  KAFKA_TOPIC_SCORING_EVENTS: z.string().default('scoring.events'),
  KAFKA_TOPIC_PAYMENT_EVENTS: z.string().default('payment.events'),
  KAFKA_TOPIC_FORUM_EVENTS: z.string().default('forum.events'),
  KAFKA_TOPIC_WRITEUP_EVENTS: z.string().default('writeup.events'),
  KAFKA_TOPIC_CTF_EVENTS: z.string().default('ctf.events'),

  // Webhook outbound
  WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  WEBHOOK_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  WEBHOOK_SIGNATURE_HEADER: z.string().default('X-Offcon-Signature'),
  WEBHOOK_TIMESTAMP_HEADER: z.string().default('X-Offcon-Timestamp'),

  // User service (for tier/preference lookups)
  USER_SVC_ADDR: z.string().default('localhost:9001'),

  // Quiet hours default
  DEFAULT_QUIET_HOURS_START: z.coerce.number().int().min(0).max(23).default(22),
  DEFAULT_QUIET_HOURS_END: z.coerce.number().int().min(0).max(23).default(7),

  // Rate limits
  PER_USER_EMAIL_PER_HOUR: z.coerce.number().int().positive().default(20),
  PER_USER_NOTIFICATIONS_PER_MIN: z.coerce.number().int().positive().default(60),

  // Logging
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  LOG_FORMAT: z.enum(['json', 'pretty']).default('json'),
});

export type AppConfig = z.infer<typeof EnvSchema> & {
  databaseUrl: string;
  redisUrl: string;
  isProduction: boolean;
};

let _config: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (_config !== null) return _config;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid configuration: ${parsed.error.message}`);
  }
  const env = parsed.data;
  const dbPw = env.DB_PASSWORD ? `:${encodeURIComponent(env.DB_PASSWORD)}` : '';
  const redisPw = env.REDIS_PASSWORD ? `:${encodeURIComponent(env.REDIS_PASSWORD)}@` : '';
  const redisScheme = env.REDIS_TLS ? 'rediss' : 'redis';

  _config = {
    ...env,
    databaseUrl: `postgresql://${env.DB_USER}${dbPw}@${env.DB_HOST}:${env.DB_PORT}/${env.DB_NAME}`,
    redisUrl: `${redisScheme}://${redisPw}${env.REDIS_HOST}:${env.REDIS_PORT}/${env.REDIS_DB}`,
    isProduction: env.APP_ENV === 'production',
  };
  return _config;
}

export function getConfig(): AppConfig {
  return _config ?? loadConfig();
}

export function resetConfig(): void {
  _config = null;
}
