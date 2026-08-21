"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * Shared motion primitives.
 *
 * Everything here writes directly to the DOM from an event or a rAF loop and
 * never through React state. That is the whole point: these are meant to be
 * used dozens of times on one screen — a dashboard, a scoreboard, a machine
 * grid — and a component that re-rendered on every mousemove would make the
 * densest pages the slowest ones.
 */

/* -------------------------------------------------------------------------- */
/* Tilt — a panel that leans toward the pointer                               */
/* -------------------------------------------------------------------------- */

/**
 * Rotation is capped low on purpose. Past about 8° the text inside starts to
 * keystone and small type gets hard to read, which is a bad trade on a surface
 * whose job is to be read. The lean should be felt, not measured.
 */
const MAX_TILT_DEG = 6;

export function Tilt({
  children,
  className,
  max = MAX_TILT_DEG,
}: {
  children: ReactNode;
  className?: string;
  max?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const onMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      el.style.transform = `perspective(900px) rotateX(${(0.5 - py) * max}deg) rotateY(${(px - 0.5) * max}deg)`;
    },
    [max],
  );

  const onLeave = useCallback(() => {
    const el = ref.current;
    if (el) el.style.transform = "perspective(900px) rotateX(0deg) rotateY(0deg)";
  }, []);

  return (
    <div
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      className={cn("transition-transform duration-300 ease-out will-change-transform", className)}
      style={{ transformStyle: "preserve-3d" }}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Reveal — staggered entrance                                                */
/* -------------------------------------------------------------------------- */

/**
 * A short rise and fade, once, when the element first reaches the viewport.
 * No scale and no blur: the page behind these is already moving, and content
 * that also flies in turns a dashboard into noise.
 */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        el.style.transitionDelay = `${delay}ms`;
        el.style.opacity = "1";
        el.style.transform = "none";
      },
      { threshold: 0.05 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [delay]);

  return (
    <div
      ref={ref}
      className={cn("transition-all duration-700 ease-out", className)}
      style={{ opacity: 0, transform: "translateY(14px)" }}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* CountUp — a figure that arrives                                            */
/* -------------------------------------------------------------------------- */

/**
 * Counts on a real clock rather than a fixed number of steps, so it takes the
 * same time on any refresh rate, and only starts once the figure is actually on
 * screen — a number that finished counting off-screen may as well be static.
 */
export function CountUp({
  value,
  duration = 1100,
  className,
  format = (n: number) => n.toLocaleString("en-US"),
}: {
  value: number;
  duration?: number;
  className?: string;
  format?: (n: number) => string;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    let frame = 0;
    let start = 0;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();

        const tick = (now: number) => {
          if (!start) start = now;
          const t = Math.min(1, (now - start) / duration);
          // Ease-out cubic: fast off the mark, settles precisely on the value.
          node.textContent = format(Math.round(value * (1 - Math.pow(1 - t, 3))));
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
  }, [value, duration, format]);

  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      {format(0)}
    </span>
  );
}
