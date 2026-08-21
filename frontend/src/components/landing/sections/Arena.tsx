"use client";

import { useState } from "react";
import clsx from "clsx";
import { Reveal, RevealGroup, RevealItem, RevealWords } from "@/components/landing/ui/Reveal";
import { Eyebrow, GhostWord } from "@/components/landing/ui/Bits";

const CAPABILITIES = [
  {
    id: "01",
    title: "Vulnerable machines",
    body: "Spin up isolated boxes and root real targets in gVisor-sandboxed labs with one click. Every box is a full system, not a puzzle box.",
    meta: "248 live · 6 difficulty tiers",
  },
  {
    id: "02",
    title: "Live CTF arena",
    body: "Jeopardy and attack-defense events with real-time scoring, first-blood alerts and a scoreboard that moves while you watch.",
    meta: "86 running · weekly finals",
  },
  {
    id: "03",
    title: "Guided tracks",
    body: "Beginner-to-elite learning paths with hands-on, gated modules. Each one ends with a box you have to root to move on.",
    meta: "34 paths · 900+ modules",
  },
  {
    id: "04",
    title: "Community forum",
    body: "Trade tradecraft with a global community. Get unstuck with nudges instead of spoilers, and level up with people ahead of you.",
    meta: "no spoilers · nudge culture",
  },
  {
    id: "05",
    title: "Writeups",
    body: "Publish and read solution writeups — unlocked only after you legitimately root the box, so nothing is spoiled before you earn it.",
    meta: "proof-gated · 40k published",
  },
  {
    id: "06",
    title: "Bug bounties",
    body: "Hunt real vulnerabilities in live programs and earn cash bounties paid straight out. The same skills, pointed at production.",
    meta: "live programs · paid out",
  },
];

/**
 * The capability index.
 *
 * Presented as a numbered register rather than a grid of cards. Cards would
 * put six competing rectangles between the reader and the canvas; a register
 * keeps the page open, and the hovered row is the only one that lights, which
 * reads as focus rather than decoration.
 */
export default function Arena() {
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <section id="arena" className="relative px-6 py-28 lg:px-10">
      <div className="mx-auto max-w-[1440px]">
        <div className="relative">
          <GhostWord className="absolute -top-14 left-0 hidden text-[16vw] lg:block">
            Arena
          </GhostWord>

          <Reveal>
            <Eyebrow index="I" label="The arena" />
          </Reveal>

          <h2 className="relative mt-7 max-w-[860px] font-display text-[clamp(30px,5vw,72px)] font-extrabold uppercase leading-[0.94] tracking-mega">
            <RevealWords text="From script-kiddie" className="block" />
            <RevealWords text="to operator" className="block" />
          </h2>

          <Reveal delay={0.2}>
            <p className="mt-7 max-w-[430px] text-[13.5px] leading-[1.75] text-text-dim">
              One platform for hands-on offensive training — labs, competitions,
              community and real bounties. Everything below is graded on proof,
              not on watching a video.
            </p>
          </Reveal>
        </div>

        <RevealGroup className="mt-20 border-t border-white/[0.07]">
          {CAPABILITIES.map((c) => {
            const dim = hovered !== null && hovered !== c.id;
            return (
              <RevealItem key={c.id}>
                <div
                  onMouseEnter={() => setHovered(c.id)}
                  onMouseLeave={() => setHovered(null)}
                  data-cursor="hover"
                  className={clsx(
                    "group relative grid cursor-default grid-cols-1 gap-4 border-b border-white/[0.07] py-8 transition-opacity duration-500 md:grid-cols-[64px_1fr_1.15fr_auto] md:items-baseline md:gap-8",
                    dim ? "opacity-35" : "opacity-100",
                  )}
                >
                  {/* Sweep of light behind the hovered row. */}
                  <span className="pointer-events-none absolute inset-x-0 -inset-y-px -z-10 origin-left scale-x-0 bg-gradient-to-r from-white/[0.07] to-transparent transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-x-100" />

                  <span className="text-[11px] tabular-nums text-text-ghost transition-colors duration-300 group-hover:text-text-dim">
                    {c.id}
                  </span>

                  <h3 className="font-display text-[clamp(20px,2.4vw,30px)] font-bold leading-tight tracking-tight transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-2">
                    {c.title}
                  </h3>

                  <p className="max-w-[520px] text-[12.5px] leading-[1.8] text-text-faint transition-colors duration-300 group-hover:text-text-dim">
                    {c.body}
                  </p>

                  <span className="whitespace-nowrap text-[10px] uppercase tracking-wide text-text-ghost">
                    {c.meta}
                  </span>
                </div>
              </RevealItem>
            );
          })}
        </RevealGroup>
      </div>
    </section>
  );
}
