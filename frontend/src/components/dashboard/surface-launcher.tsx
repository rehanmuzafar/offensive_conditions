"use client";

/**
 * Where to go next, from the dashboard.
 *
 * The three products live on their own hostnames now, which means they are no
 * longer reachable from the sidebar — a relative link cannot cross an origin.
 * Without something like this the dashboard is a dead end: signed in, and no
 * way to get to the thing you signed in for.
 *
 * Deliberately large and explicit rather than a menu. This is the first screen
 * after sign-in, and the useful question there is "which of the three am I here
 * for today", not "which of forty pages".
 */

import { Bug, GraduationCap, Swords, ArrowRight } from "lucide-react";

import { Card } from "@/components/ui/card";
import { surfaceLinks } from "@/lib/surfaces";
import { cn } from "@/lib/cn";

interface Destination {
  href: string;
  label: string;
  blurb: string;
  icon: typeof Swords;
  /** Literal Tailwind classes — the compiler only emits what it can see. */
  tone: string;
}

const DESTINATIONS: Destination[] = [
  {
    href: surfaceLinks.ctf(),
    label: "CTF Arena",
    blurb: "Live competitions, teams and scoreboards.",
    icon: Swords,
    tone: "border-accent/40 bg-accent/10 text-accent",
  },
  {
    href: surfaceLinks.app("/tracks"),
    label: "Academy",
    blurb: "Guided tracks, vulnerable machines and labs.",
    icon: GraduationCap,
    tone: "border-success/40 bg-success/10 text-success",
  },
  {
    href: surfaceLinks.bugbounty(),
    label: "Bug Bounty",
    blurb: "Hunt real programs and get paid for findings.",
    icon: Bug,
    tone: "border-warning/40 bg-warning/10 text-warning",
  },
];

export function SurfaceLauncher() {
  return (
    <section>
      <h2 className="font-display text-[19px] font-bold tracking-[-0.3px]">Where to next</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {DESTINATIONS.map((d) => {
          const Icon = d.icon;
          return (
            // A plain anchor, not next/link: these cross an origin, so there is
            // no client-side navigation to preserve and Link would only add a
            // prefetch that cannot work.
            //
            // New tab, because moving between products is a context switch
            // rather than a step: someone opening the CTF arena from here
            // usually wants their dashboard still sitting where they left it.
            <a
              key={d.label}
              href={d.href}
              target="_blank"
              rel="noreferrer noopener"
              className="group block"
            >
              <Card className="edge-iridescent h-full p-5 transition-transform duration-300 group-hover:-translate-y-1">
                <span
                  className={cn(
                    "grid h-11 w-11 place-items-center rounded-xl border transition-colors",
                    d.tone,
                  )}
                >
                  <Icon className="h-5 w-5" strokeWidth={1.8} />
                </span>
                <h3 className="mt-3.5 flex items-center gap-1.5 font-display text-[17px] font-bold tracking-[-0.3px]">
                  {d.label}
                  <ArrowRight className="h-4 w-4 -translate-x-1 opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:opacity-100" />
                </h3>
                <p className="mt-1 text-[13.5px] leading-relaxed text-text-dim">{d.blurb}</p>
              </Card>
            </a>
          );
        })}
      </div>
    </section>
  );
}
