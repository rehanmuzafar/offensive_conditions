/**
 * Seed dev plans.
 *
 * Usage:  npm run seed:dev   (or)   npx tsx scripts/seed_dev_payment.ts
 *
 * Creates a baseline of plans with regional pricing for PK / IN / BD. Safe to
 * re-run — uses ON CONFLICT on `code` to upsert.
 */

import { loadConfig } from '../src/config/index.js';
import { initPool, query, closePool } from '../src/db/pool.js';
import { getLogger } from '../src/config/logger.js';

interface PlanSeed {
  code: string;
  name: string;
  description: string;
  tier: 'free' | 'vip' | 'vip_plus' | 'team' | 'enterprise';
  billing_cycle: 'monthly' | 'annual' | 'lifetime' | 'usage';
  base_price_cents: number;
  currency: string;
  regional_pricing: Record<string, { price_cents: number; currency: string }>;
  features: string[];
  max_concurrent_instances: number;
  max_daily_spawns: number;
  sort_order: number;
}

const PLANS: PlanSeed[] = [
  {
    code: 'free',
    name: 'Free',
    description: 'Try Offensive Conditions with limited access.',
    tier: 'free',
    billing_cycle: 'monthly',
    base_price_cents: 0,
    currency: 'USD',
    regional_pricing: {},
    features: ['public_machines', 'forum_read', 'writeup_read_after_solve'],
    max_concurrent_instances: 1,
    max_daily_spawns: 5,
    sort_order: 0,
  },
  {
    code: 'vip_monthly',
    name: 'VIP — Monthly',
    description: 'Full retired machines + writeups + offline VPN.',
    tier: 'vip',
    billing_cycle: 'monthly',
    base_price_cents: 1499,
    currency: 'USD',
    regional_pricing: {
      PK: { price_cents: 79900, currency: 'PKR' },
      IN: { price_cents: 89900, currency: 'INR' },
      BD: { price_cents: 119900, currency: 'BDT' },
    },
    features: [
      'all_active_machines',
      'all_retired_machines',
      'writeups',
      'offline_vpn',
      'parallel_instances_3',
    ],
    max_concurrent_instances: 3,
    max_daily_spawns: 25,
    sort_order: 10,
  },
  {
    code: 'vip_annual',
    name: 'VIP — Annual',
    description: 'VIP at 17% off when paid yearly.',
    tier: 'vip',
    billing_cycle: 'annual',
    base_price_cents: 14990,
    currency: 'USD',
    regional_pricing: {
      PK: { price_cents: 799000, currency: 'PKR' },
      IN: { price_cents: 899000, currency: 'INR' },
    },
    features: [
      'all_active_machines',
      'all_retired_machines',
      'writeups',
      'offline_vpn',
      'parallel_instances_3',
    ],
    max_concurrent_instances: 3,
    max_daily_spawns: 25,
    sort_order: 11,
  },
  {
    code: 'vip_plus_monthly',
    name: 'VIP+ — Monthly',
    description: 'Pro Labs + advanced trees + priority queue.',
    tier: 'vip_plus',
    billing_cycle: 'monthly',
    base_price_cents: 3900,
    currency: 'USD',
    regional_pricing: {
      PK: { price_cents: 199900, currency: 'PKR' },
      IN: { price_cents: 229900, currency: 'INR' },
    },
    features: [
      'all_active_machines',
      'all_retired_machines',
      'writeups',
      'offline_vpn',
      'pro_labs',
      'advanced_skill_trees',
      'priority_queue',
      'parallel_instances_5',
    ],
    max_concurrent_instances: 5,
    max_daily_spawns: 60,
    sort_order: 20,
  },
  {
    code: 'vip_plus_annual',
    name: 'VIP+ — Annual',
    description: 'VIP+ at 17% off when paid yearly.',
    tier: 'vip_plus',
    billing_cycle: 'annual',
    base_price_cents: 39000,
    currency: 'USD',
    regional_pricing: {
      PK: { price_cents: 1999000, currency: 'PKR' },
      IN: { price_cents: 2299000, currency: 'INR' },
    },
    features: [
      'all_active_machines',
      'all_retired_machines',
      'writeups',
      'offline_vpn',
      'pro_labs',
      'advanced_skill_trees',
      'priority_queue',
      'parallel_instances_5',
    ],
    max_concurrent_instances: 5,
    max_daily_spawns: 60,
    sort_order: 21,
  },
  {
    code: 'lifetime',
    name: 'Lifetime',
    description: 'One-time payment for VIP+ forever.',
    tier: 'vip_plus',
    billing_cycle: 'lifetime',
    base_price_cents: 49900,
    currency: 'USD',
    regional_pricing: {
      PK: { price_cents: 2499000, currency: 'PKR' },
      IN: { price_cents: 2899000, currency: 'INR' },
    },
    features: [
      'all_active_machines',
      'all_retired_machines',
      'writeups',
      'offline_vpn',
      'pro_labs',
      'advanced_skill_trees',
      'priority_queue',
      'parallel_instances_5',
    ],
    max_concurrent_instances: 5,
    max_daily_spawns: 60,
    sort_order: 30,
  },
];

async function seed(): Promise<void> {
  loadConfig();
  const log = getLogger('seed');
  initPool();
  log.info({ plan_count: PLANS.length }, 'seeding_plans');

  for (const plan of PLANS) {
    await query(
      `
      INSERT INTO payment.plans (
        code, name, description, tier, billing_cycle,
        base_price_cents, currency, regional_pricing,
        features, max_concurrent_instances, max_daily_spawns,
        sort_order, is_active
      )
      VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8::JSONB,
        $9::JSONB, $10, $11,
        $12, TRUE
      )
      ON CONFLICT (code) DO UPDATE
        SET name = EXCLUDED.name,
            description = EXCLUDED.description,
            base_price_cents = EXCLUDED.base_price_cents,
            regional_pricing = EXCLUDED.regional_pricing,
            features = EXCLUDED.features,
            max_concurrent_instances = EXCLUDED.max_concurrent_instances,
            max_daily_spawns = EXCLUDED.max_daily_spawns,
            sort_order = EXCLUDED.sort_order,
            updated_at = NOW()
      `,
      [
        plan.code,
        plan.name,
        plan.description,
        plan.tier,
        plan.billing_cycle,
        plan.base_price_cents,
        plan.currency,
        JSON.stringify(plan.regional_pricing),
        JSON.stringify(plan.features),
        plan.max_concurrent_instances,
        plan.max_daily_spawns,
        plan.sort_order,
      ],
    );
    log.info({ code: plan.code, base_cents: plan.base_price_cents }, 'plan_upserted');
  }

  await closePool();
  log.info('seed_complete');
}

void seed();
