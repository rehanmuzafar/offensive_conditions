"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CreditCard, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { Card, CardBody, Skeleton } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { plansApi, type Plan } from "@/lib/plans-api";

/**
 * What the platform charges.
 *
 * The prices shown to customers were typed into the pricing page and the
 * checkout page by hand, and neither matched `payment.plans` — the table the
 * billing service actually charges against. A page quoting one number while
 * the invoice says another is worse than no page, so this edits the table and
 * every surface reads from it.
 *
 * Money is handled in cents all the way down. The field takes dollars because
 * that is what an operator thinks in, and converts once on save — a float
 * carried through the stack is how prices end up at $13.999999.
 */
export default function AdminPricingPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["plans"],
    queryFn: () => plansApi.list(),
  });

  return (
    <div className="space-y-5">
      <div>
        <h2 className="flex items-center gap-2 font-display text-[20px] font-bold">
          <CreditCard className="h-5 w-5 text-accent" /> Pricing
        </h2>
        <p className="mt-1 text-[13px] text-text-dim">
          What every plan costs. Saved here, these are the numbers the pricing
          page, the checkout and the invoice all use.
        </p>
      </div>

      {isLoading && <Skeleton className="h-80 w-full" />}
      {isError && (
        <Card>
          <CardBody className="py-14 text-center text-[13px] text-danger">
            Could not load the plans.
          </CardBody>
        </Card>
      )}

      <div className="space-y-3">
        {(data ?? []).map((plan) => (
          <PlanRow
            key={plan.code}
            plan={plan}
            onSaved={() => qc.invalidateQueries({ queryKey: ["plans"] })}
          />
        ))}
      </div>
    </div>
  );
}

function PlanRow({ plan, onSaved }: { plan: Plan; onSaved: () => void }) {
  const [name, setName] = useState(plan.name);
  const [dollars, setDollars] = useState((plan.priceCents / 100).toString());
  const [active, setActive] = useState(plan.isActive);

  // Re-seed when the query refetches, so a save elsewhere is reflected here.
  useEffect(() => {
    setName(plan.name);
    setDollars((plan.priceCents / 100).toString());
    setActive(plan.isActive);
  }, [plan]);

  const dirty =
    name !== plan.name ||
    active !== plan.isActive ||
    Math.round(Number(dollars) * 100) !== plan.priceCents;

  const save = useMutation({
    mutationFn: () =>
      plansApi.update(plan.code, {
        name: name.trim(),
        // One conversion, at the boundary. Rounding here rather than trusting
        // the float keeps 13.99 from becoming 1398 cents.
        base_price_cents: Math.round(Number(dollars) * 100),
        is_active: active,
      }),
    onSuccess: () => {
      toast.success(`${name} updated.`);
      onSaved();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not save that plan."),
  });

  function submit() {
    const n = Number(dollars);
    if (!Number.isFinite(n) || n < 0) return toast.error("Enter a price in dollars.");
    save.mutate();
  }

  const field =
    "h-10 border border-line bg-transparent px-3 text-[13px] text-text placeholder:text-text-ghost focus:border-text focus:outline-none";

  return (
    <Card>
      <CardBody className="flex flex-wrap items-end gap-4">
        <div className="min-w-[180px] flex-1">
          <label className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-wide text-text-faint">
            Plan
          </label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={cn(field, "w-full")} />
          <p className="mt-1 font-mono text-[11px] text-text-ghost">
            {plan.code} · {plan.cycle}
          </p>
        </div>

        <div className="w-[150px]">
          <label className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-wide text-text-faint">
            Price ({plan.currency})
          </label>
          <input
            value={dollars}
            inputMode="decimal"
            onChange={(e) => setDollars(e.target.value)}
            className={cn(field, "w-full font-mono")}
          />
          <p className="mt-1 text-[11px] text-text-ghost">
            {plan.cycle === "annual" ? "charged once a year" : plan.cycle === "monthly" ? "a month" : "no charge"}
          </p>
        </div>

        <label className="flex h-10 cursor-pointer items-center gap-2 text-[13px] text-text-dim">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="h-3.5 w-3.5 accent-[rgb(var(--accent))]"
          />
          Sold
        </label>

        <Button loading={save.isPending} disabled={!dirty} onClick={submit}>
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save
        </Button>
      </CardBody>
    </Card>
  );
}
