"use client";

/**
 * The landing page's WebGL scene, reused as a background for the marketing and
 * SEO pages.
 *
 * It mounts the same fixed, `-z-10`, pointer-events-none canvas the front door
 * uses — the glass skull, the refracted data backdrop, the curved grid and the
 * rain-glass pane — so these pages carry the same signature look. Three things
 * are deliberately NOT brought across from the landing layout, because they are
 * right for a hero and wrong for a page you read:
 *
 *   No Lenis smooth-scroll. Momentum scrolling fights a reader trying to hold
 *     their place in a long FAQ. Instead a tiny rAF writer populates the same
 *     `scroll` telemetry singleton the scene reads, straight from
 *     `window.scrollY`, so the skull still responds to scroll without imposing
 *     the momentum feel.
 *
 *   No cursor hijack and no intro overlay. The app keeps its native pointer,
 *     and a reading page should paint immediately, not behind a curtain.
 *
 *   A readability scrim. The landing sets short type over big negative space;
 *     these pages set long-form copy over the same scene, so a calm veil sits
 *     between the canvas and the content. The scene glows *through* it — matrix,
 *     grid and glow stay in the background, where the brief asked for them —
 *     while paragraph text keeps its contrast. Cards add their own blur on top.
 *
 * The heavy lifting — WebGL2 / reduced-motion / weak-CPU detection and the CSS
 * fallback — all lives in <Scene>, so a phone or a locked-down browser quietly
 * gets the static gradient instead of a slideshow. This component only decides
 * *where* the scene is mounted, not whether it can run.
 */

import { useEffect } from "react";

import SceneLoader from "@/components/landing/canvas/SceneLoader";
import PointerTracker from "@/components/landing/PointerTracker";
import { scroll } from "@/components/landing/lib/telemetry";

/**
 * Writes scroll telemetry from the native scroll position.
 *
 * The scene reads `scroll.progress` (skull orientation, grid drift, dust),
 * `scroll.velocity` (motion blur, dispersion) and `scroll.y`, all normally fed
 * by the Lenis loop on the landing. Here a single rAF does the same job from
 * `window.scrollY` — cheap, and it never re-renders React because these are
 * plain module globals, not state.
 */
function ScrollTelemetry() {
  useEffect(() => {
    let frame = 0;
    let lastY = window.scrollY || 0;
    const loop = () => {
      const y = window.scrollY || 0;
      const limit = Math.max(
        1,
        document.documentElement.scrollHeight - window.innerHeight,
      );
      scroll.velocity = y - lastY;
      scroll.y = y;
      scroll.progress = Math.min(1, Math.max(0, y / limit));
      lastY = y;
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, []);
  return null;
}

export default function MarketingScene() {
  return (
    <>
      <ScrollTelemetry />
      {/* Feeds pointer position + lays down the ripple wake -> the water-line
          effect that follows the cursor across the rain-glass pane. */}
      <PointerTracker />

      {/* Black ground, behind the canvas. At -z-20 so the -z-10 canvas paints
          on top of it rather than being covered by an opaque wrapper — the same
          stacking the landing layout relies on. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-20 bg-bg" />

      {/* The WebGL canvas itself (fixed, -z-10, client-only, device-guarded). */}
      <SceneLoader />

      {/* Readability veil between the scene and the content. Sits above the
          canvas (-z-10) and below the page content (z-10). Tuned to leave the
          scene clearly visible while keeping long-form text legible. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{
          zIndex: -5,
          background:
            "linear-gradient(180deg, rgba(6,6,14,0.30) 0%, rgba(6,6,14,0.55) 34%, rgba(6,6,14,0.62) 100%)",
        }}
      />
    </>
  );
}
