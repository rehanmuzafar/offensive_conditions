"use client";

import { useEffect, useRef } from "react";
import { RevealGroup, RevealItem } from "@/components/landing/ui/Reveal";

const METRICS = [
  { value: 248, suffix: "", label: "Machines & challenges", note: "live targets" },
  { value: 128, suffix: "K", label: "Active operators", note: "all regions" },
  { value: 34, suffix: "", label: "Learning paths", note: "entry → elite" },
  { value: 96, suffix: "", label: "Countries", note: "on the ladder" },
];

/**
 * Count-up figures.
 *
 * The counters run on rAF against a real clock rather than a fixed number of
 * steps, so they take the same 1.2s on any refresh rate, and they only start
 * once the row is actually on screen — a number that finished counting while
 * off-screen may as well be static text.
 */
function Counter({ value, suffix }: { value: number; suffix: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    let frame = 0;
    let start = 0;
    const DURATION = 1200;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();

        const tick = (now: number) => {
          if (!start) start = now;
          const t = Math.min(1, (now - start) / DURATION);
          // Ease-out cubic: fast off the mark, settles precisely on the value.
          const eased = 1 - Math.pow(1 - t, 3);
          node.textContent = Math.round(value * eased).toString() + suffix;
          if (t < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      },
      { threshold: 0.4 },
    );

    observer.observe(node);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [value, suffix]);

  return (
    <span ref={ref} className="tabular-nums">
      0{suffix}
    </span>
  );
}

export default function Metrics() {
  return (
    <section className="relative px-6 py-24 lg:px-10">
      <RevealGroup className="mx-auto grid max-w-[1440px] grid-cols-2 gap-px border border-white/[0.07] bg-white/[0.07] lg:grid-cols-4">
        {METRICS.map((m) => (
          <RevealItem
            key={m.label}
            className="group relative bg-black/70 px-6 py-9 backdrop-blur-md transition-colors duration-500 hover:bg-black/40"
          >
            <div className="font-display text-[clamp(34px,4.2vw,58px)] font-extrabold leading-none tracking-mega">
              <Counter value={m.value} suffix={m.suffix} />
            </div>
            <div className="mt-3 text-[11.5px] text-text-dim">{m.label}</div>
            <div className="mt-1 text-[10px] uppercase tracking-wide text-text-ghost">{m.note}</div>
            {/* Spectral underline that draws in on hover — the only colour a
                metric tile is allowed. */}
            <span className="iridescent-rule absolute bottom-0 left-0 h-px w-0 transition-[width] duration-500 group-hover:w-full" />
          </RevealItem>
        ))}
      </RevealGroup>
    </section>
  );
}
