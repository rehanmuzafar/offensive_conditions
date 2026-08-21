"use client";

import { useQuery } from "@tanstack/react-query";

import { plansApi, groupPlans } from "@/lib/plans-api";
import { Reveal, RevealWords } from "@/components/landing/ui/Reveal";
import { ActionLink, Eyebrow } from "@/components/landing/ui/Bits";

/**
 * Copy that belongs to the page, keyed by the tier it describes.
 *
 * Only the words live here. The names and the numbers come from
 * `payment.plans`, because a landing page quoting a price the checkout does not
 * charge is the one lie a pricing section cannot afford. What a plan *feels*
 * like — "Recruit", "Operator" — is marketing, and marketing is written here.
 */
const COPY: Record<string, { label: string; lines: string[] }> = {
  free: {
    label: "Recruit",
    lines: ["Retired machines", "Community forum", "Public writeups", "Global ladder"],
  },
  vip: {
    label: "Operator",
    lines: ["Every active box", "All CTF events", "Guided tracks", "Private VPN region", "Bounty programs"],
  },
  vip_plus: {
    label: "Squad",
    lines: ["Everything in Operator", "Team ladder & stats", "Private events", "Shared target pool"],
  },
};

/** Cents → "$14", or "Free" at zero. */
function money(cents: number, currency: string): string {
  if (cents === 0) return "Free";
  const symbol = currency === "USD" ? "$" : "";
  const whole = cents / 100;
  return `${symbol}${Number.isInteger(whole) ? whole : whole.toFixed(2)}`;
}


/**
 * Closing section: pricing and the final call.
 *
 * The middle plan is raised by inverting it to a light card — on a page this
 * uniformly black, inversion is a far stronger signal than a border or a
 * badge, and it costs no new colour.
 */
export default function Enlist() {
  const { data } = useQuery({
    queryKey: ["plans"],
    queryFn: () => plansApi.list(),
    staleTime: 300_000,
  });

  /* Monthly prices, because that is what this section quotes. The middle tier
     is the one the layout raises, as it always has. */
  const plans = groupPlans(data ?? []).map((group) => {
    const copy = COPY[group.tier];
    const monthly = group.monthly ?? group.annual;
    return {
      name: copy?.label ?? group.name,
      price: money(monthly?.priceCents ?? 0, monthly?.currency ?? "USD"),
      period:
        (monthly?.priceCents ?? 0) === 0
          ? "forever"
          : group.tier === "vip_plus"
            ? "per seat / month"
            : "per month",
      lines: copy?.lines ?? group.features,
      featured: group.tier === "vip",
    };
  });

  return (
    <section id="enlist" className="relative px-6 pb-28 pt-28 lg:px-10">
      <div className="mx-auto max-w-[1440px]">
        <Reveal>
          <Eyebrow index="IV" label="Enlist" />
        </Reveal>

        <div className="mt-7 flex flex-wrap items-end justify-between gap-8">
          <h2 className="font-display text-[clamp(30px,5vw,72px)] font-extrabold uppercase leading-[0.94] tracking-mega">
            <RevealWords text="Your first box" className="block" />
            <RevealWords text="is waiting" className="iridescent-text block" />
          </h2>

          <Reveal delay={0.15}>
            <p className="max-w-[350px] text-[13.5px] leading-[1.75] text-text-dim">
              Create a free account, connect to the VPN, and root your first
              machine in the next twenty minutes. No card to start.
            </p>
          </Reveal>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-px border border-white/[0.07] bg-white/[0.07] md:grid-cols-3">
          {plans.map((plan) => (
            <Reveal key={plan.name}>
              <div
                className={
                  plan.featured
                    ? "no-text-shadow flex h-full flex-col bg-text p-8 text-bg"
                    : "flex h-full flex-col bg-black/70 p-8 backdrop-blur-md"
                }
              >
                <div className="flex items-baseline justify-between">
                  <span
                    className={
                      plan.featured
                        ? "text-[10.5px] uppercase tracking-widest text-bg/60"
                        : "text-[10.5px] uppercase tracking-widest text-text-faint"
                    }
                  >
                    {plan.name}
                  </span>
                  {plan.featured && (
                    <span className="border border-black/20 px-2 py-0.5 text-[9px] uppercase tracking-wide">
                      most taken
                    </span>
                  )}
                </div>

                <div className="mt-7 flex items-baseline gap-2">
                  <span className="font-display text-[44px] font-extrabold leading-none tracking-mega">
                    {plan.price}
                  </span>
                  <span
                    className={
                      plan.featured ? "text-[11px] text-bg/55" : "text-[11px] text-text-ghost"
                    }
                  >
                    {plan.period}
                  </span>
                </div>

                <ul className="mt-8 flex-1 space-y-2.5 text-[12px]">
                  {plan.lines.map((line) => (
                    <li key={line} className="flex items-start gap-2.5">
                      <span className={plan.featured ? "text-bg/40" : "text-text-ghost"}>—</span>
                      <span className={plan.featured ? "text-bg/80" : "text-text-dim"}>
                        {line}
                      </span>
                    </li>
                  ))}
                </ul>

                <a
                  href="#top"
                  className={
                    plan.featured
                      ? "group mt-9 inline-flex items-center justify-between border-t border-black/15 pt-4 text-[12px] font-medium"
                      : "group mt-9 inline-flex items-center justify-between border-t border-white/[0.07] pt-4 text-[12px] text-text-dim transition-colors hover:text-text"
                  }
                >
                  {plan.featured ? "Start operating" : "Choose " + plan.name.toLowerCase()}
                  <span className="transition-transform duration-300 group-hover:translate-x-1.5">
                    →
                  </span>
                </a>
              </div>
            </Reveal>
          ))}
        </div>

        {/* The final word, framed like a plate on a drawing. */}
        <Reveal>
          <div className="bracket-frame mt-24 px-6 py-20 text-center md:px-16">
            <h3 className="font-display text-[clamp(28px,6.5vw,88px)] font-extrabold uppercase leading-[0.9] tracking-mega">
              <RevealWords text="Break in." className="block" />
              <RevealWords text="Legally." className="iridescent-text block" />
            </h3>
            <p className="mx-auto mt-7 max-w-[420px] text-[13px] leading-[1.8] text-text-dim">
              128,000 operators are already on the ladder. The only thing between
              you and your first root is a free account.
            </p>
            <div className="mt-10 flex flex-wrap justify-center gap-3">
              <ActionLink href="#top" variant="solid">
                Create free account
              </ActionLink>
              <ActionLink href="#arena">Read the docs</ActionLink>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
