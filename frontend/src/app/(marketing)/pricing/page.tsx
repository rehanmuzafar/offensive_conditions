"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SectionHeading } from "@/components/layout/section-heading";
import { cn } from "@/lib/cn";

type Period = "monthly" | "annual";

interface Plan {
  name: string;
  tagline: string;
  monthly: number;
  annual: number;
  featured?: boolean;
  cta: string;
  features: string[];
}

const PLANS: Plan[] = [
  {
    name: "Free",
    tagline: "Get your hands dirty.",
    monthly: 0,
    annual: 0,
    cta: "Start free",
    features: [
      "Access to retired machines",
      "Community CTF events",
      "Beginner track",
      "Forum access",
      "Global leaderboard",
    ],
  },
  {
    name: "Pro",
    tagline: "For serious operators.",
    monthly: 14,
    annual: 11,
    featured: true,
    cta: "Go Pro",
    features: [
      "Everything in Free",
      "All active machines",
      "Unlimited lab time",
      "All guided tracks",
      "Private VPN servers",
      "Writeups unlocked on root",
      "Priority CTF registration",
    ],
  },
  {
    name: "Team",
    tagline: "Train your whole squad.",
    monthly: 39,
    annual: 32,
    cta: "Start a team",
    features: [
      "Everything in Pro",
      "Up to 10 seats",
      "Team dashboard & analytics",
      "Private team CTFs",
      "Shared progress tracking",
      "Centralized billing",
    ],
  },
];

export default function PricingPage() {
  const [period, setPeriod] = useState<Period>("annual");

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
        <button
          type="button"
          role="switch"
          aria-checked={period === "annual"}
          onClick={() => setPeriod((p) => (p === "monthly" ? "annual" : "monthly"))}
          className={cn(
            "relative h-7 w-12 rounded-full transition-colors",
            period === "annual" ? "bg-brand-gradient" : "bg-line-strong",
          )}
        >
          <span
            className={cn(
              "absolute top-1 h-5 w-5 rounded-full bg-white transition-transform",
              period === "annual" ? "translate-x-6" : "translate-x-1",
            )}
          />
        </button>
        <span className={cn("text-[15px] font-medium", period === "annual" ? "text-text" : "text-text-faint")}>
          Annual
        </span>
        <Badge tone="success" className="ml-1">Save 20%</Badge>
      </div>

      {/* plans */}
      <div className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {PLANS.map((plan) => {
          const price = period === "monthly" ? plan.monthly : plan.annual;
          return (
            <Card
              key={plan.name}
              className={cn(
                "relative flex flex-col p-8",
                plan.featured && "border-accent/50 shadow-glow-lg",
              )}
            >
              {plan.featured && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge tone="brand" className="shadow-glow">
                    <Sparkles className="h-3.5 w-3.5" /> Most popular
                  </Badge>
                </span>
              )}

              <div>
                <h3 className="font-display text-[22px] font-bold">{plan.name}</h3>
                <p className="mt-1 text-[14.5px] text-text-dim">{plan.tagline}</p>
              </div>

              <div className="mt-6 flex items-end gap-1.5">
                <span className="font-display text-[48px] font-extrabold leading-none">${price}</span>
                <span className="mb-1.5 text-[15px] text-text-faint">
                  {price === 0 ? "forever" : "/ month"}
                </span>
              </div>
              {period === "annual" && price > 0 && (
                <p className="mt-1 text-[13px] text-text-faint">Billed annually (${price * 12}/yr)</p>
              )}

              <Link href="/register" className="mt-6">
                <Button fullWidth size="lg" variant={plan.featured ? "primary" : "ghost"}>
                  {plan.cta}
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
