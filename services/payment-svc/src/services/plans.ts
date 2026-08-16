/**
 * Plan service: CRUD and regional pricing resolution.
 *
 * Plans live in `payment.plans`. The `regional_pricing` JSONB column maps
 * ISO country codes (e.g. "PK", "IN") to localized price + currency. When
 * a viewer's region is known we surface the regional price so the user sees
 * the right number.
 */

import { AppError, ErrorCode } from '@/config/errors.js';
import { getLogger } from '@/config/logger.js';
import { query } from '@/db/pool.js';
import type { PlanRow } from '@/models/rows.js';
import type { PlanRead } from '@/schemas/index.js';

const log = getLogger('plans');

function rowToRead(row: PlanRow, region?: string): PlanRead {
  let regionalPriceCents: number | null = null;
  let regionalCurrency: string | null = null;
  if (region && row.regional_pricing && row.regional_pricing[region]) {
    const r = row.regional_pricing[region];
    regionalPriceCents = r.price_cents;
    regionalCurrency = r.currency;
  }
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    tier: row.tier,
    billing_cycle: row.billing_cycle,
    base_price_cents: row.base_price_cents,
    currency: row.currency,
    regional_price_cents: regionalPriceCents,
    regional_currency: regionalCurrency,
    features: row.features ?? [],
    max_concurrent_instances: row.max_concurrent_instances,
    max_daily_spawns: row.max_daily_spawns,
    is_active: row.is_active,
    is_legacy: row.is_legacy,
  };
}

export async function getPlanById(id: string): Promise<PlanRow> {
  const result = await query<PlanRow>(
    `SELECT * FROM payment.plans WHERE id = $1`,
    [id],
  );
  if (result.rows.length === 0) {
    throw new AppError(ErrorCode.PLAN_NOT_FOUND, 'plan not found');
  }
  return result.rows[0]!;
}

export async function getPlanByCode(code: string): Promise<PlanRow> {
  const result = await query<PlanRow>(
    `SELECT * FROM payment.plans WHERE code = $1`,
    [code],
  );
  if (result.rows.length === 0) {
    throw new AppError(ErrorCode.PLAN_NOT_FOUND, 'plan not found');
  }
  return result.rows[0]!;
}

export async function listPlans(opts: {
  region?: string;
  includeInactive?: boolean;
  includeLegacy?: boolean;
} = {}): Promise<PlanRead[]> {
  const conditions: string[] = [];
  if (!opts.includeInactive) conditions.push('is_active = TRUE');
  if (!opts.includeLegacy) conditions.push('is_legacy = FALSE');
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query<PlanRow>(
    `SELECT * FROM payment.plans ${where} ORDER BY sort_order ASC, base_price_cents ASC`,
  );
  return result.rows.map((row) => rowToRead(row, opts.region));
}

export async function createPlan(input: {
  code: string;
  name: string;
  description?: string | null;
  tier: PlanRow['tier'];
  billing_cycle: PlanRow['billing_cycle'];
  base_price_cents: number;
  currency: string;
  regional_pricing?: PlanRow['regional_pricing'];
  stripe_product_id?: string | null;
  stripe_price_id?: string | null;
  features: string[];
  max_concurrent_instances: number;
  max_daily_spawns: number;
}): Promise<PlanRow> {
  try {
    const result = await query<PlanRow>(
      `
      INSERT INTO payment.plans (
        code, name, description, tier, billing_cycle,
        base_price_cents, currency, regional_pricing,
        stripe_product_id, stripe_price_id,
        features, max_concurrent_instances, max_daily_spawns
      )
      VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8::JSONB,
        $9, $10,
        $11::JSONB, $12, $13
      )
      RETURNING *
      `,
      [
        input.code,
        input.name,
        input.description ?? null,
        input.tier,
        input.billing_cycle,
        input.base_price_cents,
        input.currency,
        JSON.stringify(input.regional_pricing ?? {}),
        input.stripe_product_id ?? null,
        input.stripe_price_id ?? null,
        JSON.stringify(input.features),
        input.max_concurrent_instances,
        input.max_daily_spawns,
      ],
    );
    log.info({ plan_id: result.rows[0]!.id, code: input.code }, 'plan_created');
    return result.rows[0]!;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === '23505') {
      throw new AppError(ErrorCode.CONFLICT, 'plan code already in use');
    }
    throw err;
  }
}

export async function updatePlan(
  id: string,
  patch: Partial<{
    name: string;
    description: string | null;
    base_price_cents: number;
    regional_pricing: PlanRow['regional_pricing'];
    stripe_product_id: string | null;
    stripe_price_id: string | null;
    features: string[];
    max_concurrent_instances: number;
    max_daily_spawns: number;
    is_active: boolean;
    sort_order: number;
  }>,
): Promise<PlanRow> {
  await getPlanById(id);  // 404 fast-path

  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (k === 'regional_pricing' || k === 'features') {
      sets.push(`${k} = $${idx}::JSONB`);
      values.push(JSON.stringify(v));
    } else {
      sets.push(`${k} = $${idx}`);
      values.push(v);
    }
    idx++;
  }
  if (sets.length === 0) {
    return getPlanById(id);
  }
  sets.push(`updated_at = NOW()`);
  values.push(id);
  const result = await query<PlanRow>(
    `UPDATE payment.plans SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values,
  );
  log.info({ plan_id: id }, 'plan_updated');
  return result.rows[0]!;
}

export function planRowToRead(row: PlanRow, region?: string): PlanRead {
  return rowToRead(row, region);
}
