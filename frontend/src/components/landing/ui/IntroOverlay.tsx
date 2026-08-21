"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { useUI } from "@/components/landing/lib/store";

/**
 * Boot sequence. Holds the page black until the scene has rendered, then
 * wipes upward.
 *
 * The lines are staged on a fixed cadence rather than tied to real load
 * events — the assets here are all procedural and arrive in well under a
 * second, so honest progress would flash past unreadably. The overlay does
 * still wait on `sceneReady` before dismissing, so it never uncovers a blank
 * canvas; the text is pacing, the gate is real.
 */
const LINES = [
  "offcon boot — initialising arena",
  "compiling transmission shaders",
  "seeding grid lattice · 96x24",
  "arena online",
];

export default function IntroOverlay() {
  const sceneReady = useUI((s) => s.sceneReady);
  const [step, setStep] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const timers = LINES.map((_, i) => setTimeout(() => setStep(i + 1), 220 + i * 260));
    return () => timers.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    if (sceneReady && step >= LINES.length) {
      const t = setTimeout(() => setDismissed(true), 320);
      return () => clearTimeout(t);
    }
    // Failsafe. `sceneReady` is the honest signal, but if WebGL context
    // creation stalls or the driver refuses it, an overlay that waits forever
    // means the page is simply gone. The window has to clear a cold load of
    // the three.js chunk on a slow machine — measured at ~8s here — or the
    // overlay lifts onto an empty hero, which looks worse than waiting.
    if (step >= LINES.length) {
      const t = setTimeout(() => setDismissed(true), 9000);
      return () => clearTimeout(t);
    }
  }, [sceneReady, step]);

  useEffect(() => {
    // Lock scroll while the overlay is up so the timeline starts at zero.
    document.documentElement.style.overflow = dismissed ? "" : "hidden";
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, [dismissed]);

  return (
    <div
      className={clsx(
        "fixed inset-0 z-[70] flex items-end justify-start bg-black p-8 transition-transform duration-[900ms] ease-[cubic-bezier(0.76,0,0.24,1)] lg:p-12",
        dismissed ? "pointer-events-none -translate-y-full" : "translate-y-0",
      )}
    >
      <div className="w-full max-w-[520px]">
        <div className="mb-6 h-px w-full bg-white/10">
          <div
            className="h-px bg-text transition-[width] duration-500 ease-out"
            style={{ width: `${(step / LINES.length) * 100}%` }}
          />
        </div>
        <ul className="space-y-1.5 text-[11.5px] text-text-faint">
          {LINES.map((line, i) => (
            <li
              key={line}
              className={clsx(
                "flex items-center gap-2.5 transition-opacity duration-300",
                i < step ? "opacity-100" : "opacity-0",
              )}
            >
              <span className="text-emerald-400">›</span>
              <span className={i === LINES.length - 1 ? "text-text" : undefined}>{line}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
