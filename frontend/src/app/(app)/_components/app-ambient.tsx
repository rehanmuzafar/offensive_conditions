"use client";

import AmbientScene from "@/components/landing/canvas/AmbientScene";
import { cn } from "@/lib/cn";
import type { Shape } from "./app-shell";
import PointerTracker from "@/components/landing/PointerTracker";

/**
 * One scene for the whole application shell.
 *
 * Mounted here rather than per page for two reasons. Every `AmbientScene` opens
 * its own WebGL context, so a scene on each of forty pages is forty contexts
 * created and thrown away as you navigate — and browsers cap how many may live
 * at once. And the settings would drift: four pages had already grown four
 * slightly different opacities and gains.
 *
 * The surface picks the preset, not the pathname. `usePathname()` returns the
 * URL the browser shows rather than the path the middleware rewrote to, so on
 * dashboard.<domain>/ it reads "/" — which matched nothing and dropped the
 * dashboard onto the quietest preset. That is how the skull disappeared from
 * the one surface built around it.
 */
export function AppAmbient({ shape }: { shape: Shape }) {
  const preset = presetFor(shape);

  return (
    <>
      <PointerTracker />
      <AmbientScene
        skull={preset.skull}
        matrix={preset.matrix}
        wakeGain={preset.wakeGain}
        /* The pointer turns it. `faceForward` is the sign-in pose, where the
           skull is the subject; here it is furniture. */
        faceForward={false}
        /* -z-[1] and no lower: `.app-aurora::before` paints the page's ground
           at -z-2, and anything behind that is invisible no matter how well it
           renders. */
        className={cn("pointer-events-none fixed inset-0 -z-[1]", preset.opacity)}
      />
    </>
  );
}

interface Preset {
  skull: boolean;
  matrix: boolean;
  /** Strength of the pointer wake, 1 = the marketing scene. */
  wakeGain: number;
  /** A literal class, not a number: Tailwind only emits what it can see. */
  opacity: string;
}

/**
 * Three tiers, by what the page is for.
 *
 * The scene competes with whatever is on top of it, so how loud it gets is a
 * function of how hard the page is being read — not of taste.
 */
function presetFor(shape: Shape): Preset {
  // The dashboard is a landing spot rather than a working surface: nothing on
  // it is being read against a clock, so it gets everything — the object, the
  // glyph field behind it, and the full pointer wake.
  if (shape === "dashboard") {
    return { skull: true, matrix: true, wakeGain: 1, opacity: "opacity-90" };
  }

  // Everything past the dashboard is a working surface, and the wake is off on
  // all of them. It is a flourish, and a flourish that follows the cursor across
  // a scoreboard or a form competes with the work being done on it. The grid
  // itself stays; only the pointer disturbance goes.
  if (shape === "ctf") {
    return { skull: false, matrix: true, wakeGain: 0, opacity: "opacity-75" };
  }

  // The Academy — catalogues, forms, tables.
  return { skull: false, matrix: false, wakeGain: 0, opacity: "opacity-[0.55]" };
}
