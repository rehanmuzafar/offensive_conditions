/**
 * PostgreSQL connection pool with helpers.
 *
 * Uses `pg.Pool`. Every query goes through `query()` for instrumentation;
 * transactions use `withTransaction()` to ensure connection acquisition,
 * BEGIN/COMMIT/ROLLBACK, and release happen atomically.
 */

import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

import { getConfig } from '@/config/index.js';
import { getLogger } from '@/config/logger.js';

const log = getLogger('db');

let _pool: Pool | null = null;

export function initPool(): Pool {
  if (_pool !== null) {
    return _pool;
  }
  const cfg = getConfig();
  _pool = new Pool({
    host: cfg.DB_HOST,
    port: cfg.DB_PORT,
    database: cfg.DB_NAME,
    user: cfg.DB_USER,
    password: cfg.DB_PASSWORD,
    ssl: cfg.DB_SSL ? { rejectUnauthorized: true } : false,
    max: cfg.DB_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 30_000,
  });
  _pool.on('error', (err) => {
    log.error({ err }, 'pg_pool_error');
  });
  log.info({ host: cfg.DB_HOST, db: cfg.DB_NAME, pool_max: cfg.DB_POOL_MAX }, 'pg_pool_initialized');
  return _pool;
}

export function getPool(): Pool {
  if (_pool === null) {
    throw new Error('Database pool not initialized — call initPool() first');
  }
  return _pool;
}

export async function closePool(): Promise<void> {
  if (_pool !== null) {
    await _pool.end();
    _pool = null;
    log.info('pg_pool_closed');
  }
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: ReadonlyArray<unknown>,
): Promise<QueryResult<T>> {
  const start = Date.now();
  const pool = getPool();
  try {
    // pg accepts a mutable array; cast safely to satisfy the signature.
    const result = await pool.query<T>(text, params as unknown as unknown[]);
    const ms = Date.now() - start;
    if (ms > 1000) {
      log.warn({ ms, text: text.slice(0, 120) }, 'slow_query');
    }
    return result;
  } catch (err) {
    log.error({ err, text: text.slice(0, 200) }, 'query_error');
    throw err;
  }
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
  isolationLevel: 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE' = 'READ COMMITTED',
): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query(`BEGIN ISOLATION LEVEL ${isolationLevel}`);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      log.error({ err: rollbackErr }, 'rollback_failed');
    }
    throw err;
  } finally {
    client.release();
  }
}
