"use client";

import { useQuery } from "@tanstack/react-query";

import { scoringApi } from "@/lib/scoring-api";
import { ctfApi } from "@/lib/community-api";

import { useEffect, useRef } from "react";
import { RevealWords, Reveal } from "@/components/landing/ui/Reveal";
import { ActionLink } from "@/components/landing/ui/Bits";
import { scroll } from "@/components/landing/lib/telemetry";

/**
 * The hero is mostly negative space on purpose: the shield behind it is the
 * subject, and the type frames it rather than competing. The headline is split
 * across two lines with the glass passing between them.
 */
export default function Hero() {
  /* The badge used to read "Season 7 · 86 active CTFs" — both invented. This is
     the first line a visitor reads about the platform, so it says what is
     actually true. Both endpoints are public. */
  const { data: seasons } = useQuery({
    queryKey: ["landing-seasons"],
    queryFn: () => scoringApi.seasons(),
    staleTime: 300_000,
  });
  const { data: events } = useQuery({
    queryKey: ["landing-live-events"],
    queryFn: () => ctfApi.listEvents("live"),
    staleTime: 60_000,
  });
  const season = (seasons ?? []).find((s) => s.isActive) ?? seasons?.[0] ?? null;
  const liveEvents = events ? events.items.length : null;

  const stack = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Type drifts up and fades as the shield takes over the frame. Written
    // straight to style on rAF; a scroll-linked framer value would re-render
    // the whole hero subtree every tick.
    let frame = 0;
    const loop = () => {
      const el = stack.current;
      if (el) {
        const t = Math.min(1, scroll.y / (window.innerHeight * 0.9));
        el.style.transform = `translate3d(0, ${-t * 90}px, 0)`;
        el.style.opacity = `${Math.max(0, 1 - t * 1.15)}`;
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <section id="top" className="relative flex min-h-[100svh] flex-col justify-between px-6 pb-10 pt-[110px] lg:px-10">
      <div ref={stack} className="mx-auto w-full max-w-[1440px] will-change-transform">
        <Reveal>
          <div className="flex items-center gap-3 text-[10.5px] uppercase tracking-widest text-text-dim">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </span>
            {season ? `${season.name} live` : "Season live"}
            <span className="text-text-ghost">·</span>
            {liveEvents === null
              ? "loading events"
              : `${liveEvents} live CTF${liveEvents === 1 ? "" : "s"}`}
          </div>
        </Reveal>

        {/* Two lines, sized to leave the middle of the frame to the glass. */}
        <h1 className="mt-8 font-display text-[clamp(46px,9.4vw,148px)] font-extrabold uppercase leading-[0.87] tracking-mega">
          <RevealWords text="Forge yourself" className="block" />
          <span className="mt-1 block lg:mt-2 lg:pl-[38%]">
            <RevealWords text="in the dark" className="iridescent-text" />
          </span>
        </h1>

        <Reveal delay={0.35}>
          <p className="mt-9 max-w-[420px] text-[13.5px] leading-[1.75] text-text-dim">
            Hands-on labs, live CTF competitions and battle-ready machines.
            Train against real vulnerable systems, capture flags, and climb the
            global ranks.
          </p>
        </Reveal>

        <Reveal delay={0.45}>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <ActionLink href="#enlist" variant="solid">
              Start hacking — free
            </ActionLink>
            <ActionLink href="#machines">Explore machines</ActionLink>
          </div>
        </Reveal>
      </div>

      {/* Baseline strip: reads as the status bar of an instrument, and gives
          the bottom of the frame a horizon the shield can cross. */}
      <Reveal delay={0.6}>
        <div className="mx-auto flex w-full max-w-[1440px] items-end justify-between gap-6 border-t border-white/[0.07] pt-4 text-[10.5px] uppercase tracking-wide text-text-faint">
          <span className="hidden sm:block">128,000+ operators worldwide</span>
          <span className="hidden md:block">gVisor-isolated targets</span>
          <span className="flex items-center gap-2">
            <span className="h-px w-6 bg-text-ghost" />
            scroll to descend
          </span>
        </div>
      </Reveal>
    </section>
  );
}
