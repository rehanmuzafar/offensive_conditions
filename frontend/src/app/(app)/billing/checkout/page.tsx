"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Sparkles, Lock } from "lucide-react";

import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useCheckout, useSubscription } from "@/hooks/use-account";
import { cn } from "@/lib/cn";
import type { PlanId, BillingPeriod } from "@/types/account";

interface PlanOption {
  id: PlanId;
  name: string;
  monthly: number;
  annual: number;
  features: string[];
  featured?: boolean;
}

const PLANS: PlanOption[] = [
  { id: "pro", name: "Pro", monthly: 14, annual: 11, featured: true, features: ["All active machines", "Unlimited lab time", "All guided tracks", "Private VPN servers", "Writeups unlocked on root"] },
  { id: "team", name: "Team", monthly: 39, annual: 32, features: ["Everything in Pro", "Up to 10 seats", "Team dashboard", "Private team CTFs", "Centralized billing"] },
];

export default function CheckoutPage() {
  const checkout = useCheckout();
  const { data: sub } = useSubscription();
  const [period, setPeriod] = useState<BillingPeriod>("annual");
  const [planId, setPlanId] = useState<PlanId>("pro");
  const [seats, setSeats] = useState(3);

  const plan = PLANS.find((p) => p.id === planId)!;
  const price = period === "monthly" ? plan.monthly : plan.annual;
  const monthlyTotal = price * (planId === "team" ? seats : 1);
  const billedNow = period === "annual" ? monthlyTotal * 12 : monthlyTotal;

  function startCheckout() {
    checkout.mutate({ planId, period, seats: planId === "team" ? seats : undefined });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/billing" className="inline-flex items-center gap-1.5 text-[14px] text-text-dim hover:text-text">
        <ArrowLeft className="h-4 w-4" /> Billing
      </Link>

      <div>
        <h1 className="font-display text-[28px] font-extrabold tracking-[-0.5px]">Choose your plan</h1>
        <p className="mt-1 text-[15px] text-text-dim">Upgrade to unlock the full arsenal. Cancel anytime.</p>
      </div>

      {/* period toggle */}
      <div className="flex items-center gap-3">
        <button onClick={() => setPeriod("monthly")} className={cn("rounded-lg border px-4 py-2 text-[14px] font-semibold transition-colors", period === "monthly" ? "border-accent bg-brand-gradient-soft text-accent" : "border-line-strong text-text-dim")}>Monthly</button>
        <button onClick={() => setPeriod("annual")} className={cn("flex items-center gap-2 rounded-lg border px-4 py-2 text-[14px] font-semibold transition-colors", period === "annual" ? "border-accent bg-brand-gradient-soft text-accent" : "border-line-strong text-text-dim")}>
          Annual <Badge tone="success">Save 20%</Badge>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* plan selection */}
        <div className="space-y-4">
          {PLANS.map((p) => {
            const selected = planId === p.id;
            const pPrice = period === "monthly" ? p.monthly : p.annual;
            return (
              <Card key={p.id} className={cn("cursor-pointer transition-all", selected ? "border-accent shadow-glow" : "hover:border-line-strong")} interactive={!selected}>
                <CardBody>
                  <button onClick={() => setPlanId(p.id)} className="w-full text-left">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2.5">
                        <span className={cn("grid h-5 w-5 place-items-center rounded-full border-2", selected ? "border-accent bg-accent" : "border-line-strong")}>
                          {selected && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-display text-[18px] font-bold">{p.name}</h3>
                            {p.featured && <Badge tone="brand"><Sparkles className="h-3 w-3" /> Popular</Badge>}
                          </div>
                          <div className="mt-0.5 text-[13px] text-text-faint">
                            ${pPrice}/mo{p.id === "team" ? " per seat" : ""}{period === "annual" ? ", billed annually" : ""}
                          </div>
                        </div>
                      </div>
                    </div>
                    <ul className="mt-4 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      {p.features.map((f) => (
                        <li key={f} className="flex items-center gap-2 text-[13px] text-text-dim">
                          <Check className="h-3.5 w-3.5 shrink-0 text-success" strokeWidth={2.5} /> {f}
                        </li>
                      ))}
                    </ul>
                  </button>

                  {/* seats stepper for team */}
                  {p.id === "team" && selected && (
                    <div className="mt-4 flex items-center gap-3 border-t border-line pt-4">
                      <span className="text-[13.5px] font-medium">Seats</span>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setSeats((s) => Math.max(2, s - 1))} className="grid h-8 w-8 place-items-center rounded-lg border border-line-strong text-text-dim hover:text-text">−</button>
                        <span className="w-8 text-center font-display text-[16px] font-bold">{seats}</span>
                        <button onClick={() => setSeats((s) => Math.min(10, s + 1))} className="grid h-8 w-8 place-items-center rounded-lg border border-line-strong text-text-dim hover:text-text">+</button>
                      </div>
                    </div>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>

        {/* order summary */}
        <Card className="h-fit">
          <CardBody>
            <h3 className="mb-4 font-display text-[17px] font-bold">Order summary</h3>
            <div className="space-y-2.5 text-[14px]">
              <div className="flex justify-between">
                <span className="text-text-dim">{plan.name} plan{planId === "team" ? ` × ${seats} seats` : ""}</span>
                <span className="font-medium">${monthlyTotal}/mo</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-dim">Billing period</span>
                <span className="font-medium capitalize">{period}</span>
              </div>
              {period === "annual" && (
                <div className="flex justify-between text-success">
                  <span>Annual discount</span>
                  <span className="font-medium">−20%</span>
                </div>
              )}
              <div className="border-t border-line pt-2.5">
                <div className="flex items-baseline justify-between">
                  <span className="font-display text-[15px] font-bold">Billed now</span>
                  <span className="font-display text-[24px] font-extrabold text-gradient">${billedNow}</span>
                </div>
                <div className="mt-0.5 text-right text-[12px] text-text-faint">
                  {period === "annual" ? "per year" : "per month"}
                </div>
              </div>
            </div>

            <Button fullWidth size="lg" className="mt-5" loading={checkout.isPending} onClick={startCheckout}>
              <Lock className="h-[18px] w-[18px]" /> Continue to payment
            </Button>
            <p className="mt-3 flex items-center justify-center gap-1.5 text-[12px] text-text-faint">
              <Lock className="h-3 w-3" /> Secure checkout · cancel anytime
            </p>
            {sub?.planId !== "free" && (
              <p className="mt-2 text-center text-[12px] text-text-faint">
                You&apos;ll be switched from your current {sub?.planId} plan.
              </p>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
