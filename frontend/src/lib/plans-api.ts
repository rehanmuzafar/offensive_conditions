/**
 * Subscription plans, as the billing service holds them.
 *
 * The prices shown in the product were hard-coded in three separate places —
 * the marketing pricing page, the checkout page, and a plan list in mock data —
 * and none of them matched `payment.plans`, which is what a customer is
 * actually charged against. A page that quotes $14 while the invoice says
 * something else is worse than no pricing page.
 *
 * So this is the single source. It is public: the pricing page has to render
 * for a visitor who has never signed in.
 */

import { api } from "@/lib/api";

export type BillingCycle = "monthly" | "annual" | "usage";

interface ApiPlan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  tier: string;
  billing_cycle: BillingCycle;
  base_price_cents: number;
  currency: string;
  regional_price_cents: number | null;
  regional_currency: string | null;
  features: string[] | null;
  max_concurrent_instances: number | null;
  max_daily_spawns: number | null;
  is_active: boolean;
  is_legacy: boolean;
}

export interface Plan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  /** free | vip | vip_plus — what the platform gates access on. */
  tier: string;
  cycle: BillingCycle;
  priceCents: number;
  currency: string;
  features: string[];
  isActive: boolean;
}

/**
 * One product line, with both of its prices.
 *
 * The table stores monthly and annual as separate rows because they are
 * separate things to bill; a pricing page shows one card with a toggle. This
 * folds the pair back together by tier so the page does not have to.
 */
export interface PlanGroup {
  tier: string;
  name: string;
  description: string | null;
  features: string[];
  monthly: Plan | null;
  annual: Plan | null;
}

function mapPlan(p: ApiPlan): Plan {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    description: p.description,
    tier: p.tier,
    cycle: p.billing_cycle,
    priceCents: p.regional_price_cents ?? p.base_price_cents,
    currency: p.regional_currency ?? p.currency,
    features: p.features ?? [],
    isActive: p.is_active,
  };
}

/** Strips the "(Monthly)"/"(Annual)" the codes carry, so a card reads as one product. */
function productName(name: string): string {
  return name.replace(/\s*\((monthly|annual|yearly)\)\s*$/i, "").trim();
}

export const plansApi = {
  list: async (): Promise<Plan[]> => {
    const res = await api.get<{ items: ApiPlan[] }>("/v1/billing/plans", { anonymous: true });
    return (res.items ?? []).map(mapPlan);
  },

  /** Admin: change what a plan costs. */
  update: (
    code: string,
    body: {
      name?: string;
      description?: string | null;
      base_price_cents?: number;
      features?: string[];
      is_active?: boolean;
      sort_order?: number;
    },
  ) => api.patch<ApiPlan>(`/v1/billing/plans/${code}`, { body }),
};

/** Folds the monthly/annual rows of each tier into one card's worth of data. */
export function groupPlans(plans: Plan[]): PlanGroup[] {
  const byTier = new Map<string, PlanGroup>();
  for (const plan of plans) {
    if (!plan.isActive) continue;
    const group = byTier.get(plan.tier) ?? {
      tier: plan.tier,
      name: productName(plan.name),
      description: plan.description,
      features: plan.features,
      monthly: null,
      annual: null,
    };
    // A usage plan (the free tier) has no cycle to choose, so it fills both
    // sides and the toggle simply does not change it.
    if (plan.cycle === "annual") group.annual = plan;
    else group.monthly = plan;
    if (plan.cycle === "usage") group.annual = plan;
    if (plan.features.length > group.features.length) group.features = plan.features;
    group.description ??= plan.description;
    byTier.set(plan.tier, group);
  }
  const order = ["free", "vip", "vip_plus"];
  return [...byTier.values()].sort(
    (a, b) => (order.indexOf(a.tier) + 1 || 99) - (order.indexOf(b.tier) + 1 || 99),
  );
}
