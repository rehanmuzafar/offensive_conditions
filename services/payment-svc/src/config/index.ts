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
  APP_NAME: z.string().default('payment-svc'),
  APP_VERSION: z.string().default('0.1.0'),

  // HTTP
  HTTP_PORT: z.coerce.number().int().positive().default(8007),
  HTTP_HOST: z.string().default('0.0.0.0'),
  HTTP_CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((v) => v.split(',').map((s) => s.trim())),

  // gRPC
  GRPC_PORT: z.coerce.number().int().positive().default(9007),

  // Database
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_NAME: z.string().default('offcon'),
  DB_USER: z.string().default('payment_svc'),
  DB_PASSWORD: z.string().default(''),
  DB_SSL: boolFromEnv(false),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),

  // Redis
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().default(''),
  REDIS_DB: z.coerce.number().int().min(0).max(15).default(6),
  REDIS_TLS: boolFromEnv(false),

  // Auth
  AUTH_JWT_PUBLIC_KEY_PATH: z.string().default('./testdata/jwt.pub'),
  AUTH_JWT_ISSUER: z.string().default('https://auth.offensiveconditions.org'),
  AUTH_JWT_AUDIENCE: z.string().default('offcon-api'),

  // Stripe
  STRIPE_SECRET_KEY: z.string().startsWith('sk_').default('sk_test_placeholder'),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith('whsec_').default('whsec_placeholder'),
  STRIPE_API_VERSION: z.string().default('2024-11-20.acacia'),
  STRIPE_RETURN_URL: z.string().url().default('https://app.offensiveconditions.org/billing/return'),
  STRIPE_CANCEL_URL: z.string().url().default('https://app.offensiveconditions.org/billing/cancel'),
  STRIPE_PORTAL_RETURN_URL: z.string().url().default('https://app.offensiveconditions.org/settings/billing'),

  // Kafka
  KAFKA_BROKERS: z
    .string()
    .default('localhost:9092')
    .transform((v) => v.split(',').map((s) => s.trim())),
  KAFKA_TOPIC_PAYMENT_EVENTS: z.string().default('payment.events'),
  KAFKA_TOPIC_AUTH_EVENTS: z.string().default('auth.events'),
  KAFKA_CONSUMER_GROUP: z.string().default('payment-svc'),
  KAFKA_USE_TLS: boolFromEnv(false),
  KAFKA_USERNAME: z.string().optional(),
  KAFKA_PASSWORD: z.string().optional(),

  // Webhook dedup
  WEBHOOK_DEDUP_TTL_DAYS: z.coerce.number().int().positive().default(7),

  // Risk
  RISK_BLOCK_SCORE_THRESHOLD: z.coerce.number().min(0).max(100).default(80),

  // Limits
  CHECKOUT_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(5),
  PORTAL_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(10),

  // Default trial days
  DEFAULT_TRIAL_DAYS: z.coerce.number().int().min(0).default(7),

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
  if (_config !== null) {
    return _config;
  }
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
  if (_config === null) {
    return loadConfig();
  }
  return _config;
}

/** For tests — clear the cached config so tests can mutate env between cases. */
export function resetConfig(): void {
  _config = null;
}
