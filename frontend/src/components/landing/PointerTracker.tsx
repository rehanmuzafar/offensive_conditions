"use client";

import { useEffect } from "react";
import { pointer, damp } from "@/components/landing/lib/telemetry";
import { dropRipple } from "@/components/landing/lib/ripples";

/**
 * Single global pointer listener. Writes the raw normalised position on the
 * event and damps it on rAF, so the scene gets a smooth signal even though
 * pointermove fires irregularly (and can burst far above frame rate).
 *
 * Before the first real movement the smoothed value drifts on a slow Lissajous
 * path — that keeps the hero alive on load and on touch devices, where a
 * pointer may never arrive at all.
 *
 * It also lays down the wake: a ripple breadcrumb at the raw position on every
 * move. That happens on the event rather than on the rAF tick on purpose —
 * a fast flick can cover half the screen between two frames, and sampling the
 * damped value would give the wake a smooth curve the cursor never took.
 */
export default function PointerTracker() {
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const nx = e.clientX / window.innerWidth;
      const ny = e.clientY / window.innerHeight;

      pointer.raw.x = nx * 2 - 1;
      pointer.raw.y = -(ny * 2 - 1);
      pointer.active = true;

      // gl_FragCoord counts up from the bottom, so flip y here rather than in
      // every shader that reads the wake.
      dropRipple(nx, 1 - ny, performance.now() / 1000);
    };

    // Leaving the window should ease the scene back to centre, not freeze it.
    const onLeave = () => {
      pointer.raw.x = 0;
      pointer.raw.y = 0;
    };

    let frame = 0;
    let last = performance.now();

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      if (!pointer.active) {
        const t = now / 1000;
        pointer.raw.x = Math.sin(t * 0.24) * 0.35;
        pointer.raw.y = Math.cos(t * 0.19) * 0.22;
      }

      pointer.smooth.x = damp(pointer.smooth.x, pointer.raw.x, 4.5, dt);
      pointer.smooth.y = damp(pointer.smooth.y, pointer.raw.y, 4.5, dt);

      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return null;
}
