"use client";

import { useEffect } from "react";
import Lenis from "lenis";
import { scroll, sections } from "@/components/landing/lib/telemetry";
import { useUI } from "@/components/landing/lib/store";

/**
 * Owns the single Lenis instance and is the only writer of `scroll`.
 *
 * Lenis is driven manually from rAF rather than its own loop so that the
 * scroll value is guaranteed to be updated *before* R3F renders the frame
 * that consumes it — otherwise the canvas lags the DOM by one frame, which
 * is visible as a shear between the two layers during fast flicks.
 */
export default function SmoothScroll({ children }: { children: React.ReactNode }) {
  const setActive = useUI((s) => s.setActive);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const lenis = new Lenis({
      duration: reduced ? 0 : 1.15,
      easing: (t: number) => 1 - Math.pow(1 - t, 3),
      smoothWheel: !reduced,
      wheelMultiplier: 0.95,
      touchMultiplier: 1.4,
    });

    let frame = 0;
    let lastY = 0;

    const loop = (time: number) => {
      lenis.raf(time);

      const y = lenis.scroll;
      const limit = Math.max(1, lenis.limit);
      scroll.velocity = y - lastY;
      lastY = y;
      scroll.y = y;
      scroll.progress = y / limit;

      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    // Section tracking is separate from the scroll value: it only needs to fire
    // when the *label* changes, so an observer beats sampling every frame.
    const observer = new IntersectionObserver(
      (entries) => {
        // Prefer whichever tracked section covers the middle of the viewport.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActive(visible.target.id as (typeof sections)[number]["id"]);
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: [0, 0.01, 0.5, 1] },
    );

    for (const s of sections) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }

    // Anchor links should hand off to Lenis rather than jumping.
    const onClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement | null)?.closest?.('a[href^="#"]');
      if (!anchor) return;
      const id = anchor.getAttribute("href")!.slice(1);
      const target = document.getElementById(id);
      if (!target) return;
      e.preventDefault();
      lenis.scrollTo(target, { offset: -40 });
    };
    document.addEventListener("click", onClick);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("click", onClick);
      lenis.destroy();
    };
  }, [setActive]);

  return <>{children}</>;
}
