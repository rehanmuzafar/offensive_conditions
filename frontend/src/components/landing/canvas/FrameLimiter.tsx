import { useEffect } from "react";
import { useThree } from "@react-three/fiber";

/**
 * Caps how often the scene redraws — the fix for a GPU that runs flat-out (and
 * hot) rendering a background nobody is studying frame-by-frame.
 *
 * The canvas runs `frameloop="demand"`, so it only paints when this asks. It
 * asks at `activeFps` while the visitor scrolls or moves the pointer, drops to
 * `idleFps` a couple of seconds after they stop — reading the page then costs
 * almost nothing — and asks for nothing at all while the tab is hidden. Every
 * animation steps by real elapsed time, so a lower rate only makes the drift a
 * little coarser, never wrong.
 */

// One activity clock shared by whatever scenes are mounted on the page.
let lastActivity = typeof performance !== "undefined" ? performance.now() : 0;

export default function FrameLimiter({
  activeFps = 60,
  idleFps = 10,
  idleAfterMs = 2200,
}: {
  activeFps?: number;
  idleFps?: number;
  idleAfterMs?: number;
}) {
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    const bump = () => {
      lastActivity = performance.now();
    };
    const opts: AddEventListenerOptions = { passive: true };
    window.addEventListener("scroll", bump, opts);
    window.addEventListener("pointermove", bump, opts);
    window.addEventListener("wheel", bump, opts);
    window.addEventListener("touchmove", bump, opts);
    window.addEventListener("pointerdown", bump, opts);

    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return; // nothing to paint for a hidden tab
      const idle = performance.now() - lastActivity > idleAfterMs;
      const fps = idle ? idleFps : activeFps;
      if (t - last >= 1000 / fps) {
        last = t;
        invalidate();
      }
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", bump);
      window.removeEventListener("pointermove", bump);
      window.removeEventListener("wheel", bump);
      window.removeEventListener("touchmove", bump);
      window.removeEventListener("pointerdown", bump);
    };
  }, [invalidate, activeFps, idleFps, idleAfterMs]);

  return null;
}
