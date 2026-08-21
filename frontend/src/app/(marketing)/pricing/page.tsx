"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SectionHeading } from "@/components/layout/section-heading";
import { useQuery } from "@tanstack/react-query";

import { cn } from "@/lib/cn";
import { plansApi, groupPlans } from "@/lib/plans-api";
import { SkullGlyph } from "@/components/brand/skull-glyph";

type Period = "monthly" | "annual";

/** Cents → "$14". Whole dollars, because every plan is priced in them. */
function money(cents: number, currency: string): string {
  const symbol = currency === "USD" ? "$" : "";
  const whole = cents / 100;
  return `${symbol}${Number.isInteger(whole) ? whole : whole.toFixed(2)}`;
}


export default function PricingPage() {
  const [period, setPeriod] = useState<Period>("annual");

  /* The real plans, from the service that bills them. These numbers used to be
     typed into this file, the checkout page and the mock data separately — and
     none of the three matched what payment.plans actually charges. */
  const { data, isLoading } = useQuery({
    queryKey: ["plans"],
    queryFn: () => plansApi.list(),
    staleTime: 300_000,
  });
  const groups = groupPlans(data ?? []);

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-20">
      <SectionHeading
        eyebrow="Pricing"
        title="Train at your level. Upgrade when you're ready."
        subtitle="Start free forever. Go Pro for the full arsenal. Cancel anytime."
      />

      {/* billing toggle */}
      <div className="mt-9 flex items-center justify-center gap-4">
        <span className={cn("text-[15px] font-medium", period === "monthly" ? "text-text" : "text-text-faint")}>
          Monthly
        </span>
        {/* The knob is the skull, in the violet the 3D object is tinted with.
            It used to be a white dot on a `bg-brand-gradient` track — and that
            gradient was later redefined to near-black, so on this dark page the
            track vanished and the dot looked like it had escaped its control.
            The track now carries a visible border in both states. */}
        <button
          type="button"
          role="switch"
          aria-checked={period === "annual"}
          onClick={() => setPeriod((p) => (p === "monthly" ? "annual" : "monthly"))}
          className={cn(
            "relative h-8 w-[60px] shrink-0 border transition-colors duration-300",
            period === "annual"
              ? "border-[#8B5CF6]/70 bg-[#8B5CF6]/15"
              : "border-line-strong bg-surface",
          )}
        >
          <span
            className={cn(
              "absolute left-0 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center",
              "transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
              // 60px track − 28px knob − 2px of border = 30px of travel.
              period === "annual" ? "translate-x-[30px]" : "translate-x-[2px]",
            )}
          >
            <SkullGlyph
              className={cn(
                "h-[22px] w-[22px] transition-colors duration-300",
                // #c8b4ff is the glass skull's attenuation colour — what the
                // 3D object actually reads as. Dimmed when the switch is off,
                // so the state is legible without moving the eye to the labels.
                period === "annual" ? "text-[#c8b4ff]" : "text-text-faint",
              )}
            />
          </span>
        </button>
        <span className={cn("text-[15px] font-medium", period === "annual" ? "text-text" : "text-text-faint")}>
          Annual
        </span>
        <Badge tone="success" className="ml-1">Save 20%</Badge>
      </div>

      {/* plans */}
      <div className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {isLoading && (
          <p className="col-span-full py-16 text-center text-[14px] text-text-dim">
            Loading plans…
          </p>
        )}
        {!isLoading && groups.length === 0 && (
          <p className="col-span-full py-16 text-center text-[14px] text-text-dim">
            Plans are unavailable right now.
          </p>
        )}
        {groups.map((plan) => {
          /* A usage plan has one row and no cycle to choose; the paid tiers
             have both, and an annual price is quoted per month the way every
             comparable page does — the yearly total is spelled out below it. */
          const chosen = period === "annual" ? (plan.annual ?? plan.monthly) : (plan.monthly ?? plan.annual);
          const cents = chosen?.priceCents ?? 0;
          const currency = chosen?.currency ?? "USD";
          const perMonth = chosen?.cycle === "annual" ? Math.round(cents / 12) : cents;
          // The middle tier is the one the page pushes, as before.
          const featured = plan.tier === "vip";
          return (
            <Card
              key={plan.tier}
              className={cn(
                "relative flex flex-col p-8",
                featured && "border-accent/50 shadow-glow-lg",
              )}
            >
              {featured && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge tone="brand" className="shadow-glow">
                    <Sparkles className="h-3.5 w-3.5" /> Most popular
                  </Badge>
                </span>
              )}

              <div>
                <h3 className="font-display text-[22px] font-bold">{plan.name}</h3>
                <p className="mt-1 text-[14.5px] text-text-dim">
                  {plan.description ?? "\u00a0"}
                </p>
              </div>

              <div className="mt-6 flex items-end gap-1.5">
                <span className="font-display text-[48px] font-extrabold leading-none">
                  {money(perMonth, currency)}
                </span>
                <span className="mb-1.5 text-[15px] text-text-faint">
                  {cents === 0 ? "forever" : "/ month"}
                </span>
              </div>
              {chosen?.cycle === "annual" && cents > 0 && (
                <p className="mt-1 text-[13px] text-text-faint">
                  Billed annually ({money(cents, currency)}/yr)
                </p>
              )}

              <Link href="/register" className="mt-6">
                <Button fullWidth size="lg" variant={featured ? "primary" : "ghost"}>
                  {cents === 0 ? "Start free" : `Get ${plan.name}`}
                </Button>
              </Link>

              <ul className="mt-8 space-y-3">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-[14.5px] text-text-dim">
                    <span className="mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-success/15">
                      <Check className="h-3 w-3 text-success" strokeWidth={3} />
                    </span>
                    {f}
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>

      {/* enterprise strip */}
      <Card variant="glass" className="mt-8 flex flex-col items-center justify-between gap-5 p-8 sm:flex-row">
        <div>
          <h3 className="font-display text-[20px] font-bold">Enterprise &amp; education</h3>
          <p className="mt-1 text-[14.5px] text-text-dim">
            SSO, custom labs, dedicated infrastructure, and volume seats for orgs and universities.
          </p>
        </div>
        <Link href="/contact">
          <Button variant="outline" size="lg">Contact sales</Button>
        </Link>
      </Card>

      {/* faq */}
      <div className="mx-auto mt-20 max-w-[760px]">
        <SectionHeading title="Frequently asked" />
        <div className="mt-8 space-y-3">
          {FAQ.map((f) => (
            <Card key={f.q} className="p-6">
              <h4 className="font-display text-[16.5px] font-semibold">{f.q}</h4>
              <p className="mt-2 text-[14.5px] text-text-dim">{f.a}</p>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

const FAQ = [
  { q: "Can I really learn for free?", a: "Yes. The Free plan gives you retired machines, community CTFs, the beginner track, and the forum — forever, no card required." },
  { q: "What happens when I cancel Pro?", a: "You keep your account, progress, and rank. You simply lose access to Pro-only active machines and unlimited lab time at the end of the period." },
  { q: "Do you offer student discounts?", a: "We do. Reach out via the contact page with your student email and we'll sort you out with education pricing." },
  { q: "How do team seats work?", a: "Team includes up to 10 seats with a shared dashboard, private team CTFs, and centralized billing. Need more seats? Talk to sales." },
];
