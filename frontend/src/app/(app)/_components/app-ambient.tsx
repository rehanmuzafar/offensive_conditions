"use client";

import { usePathname } from "next/navigation";

import AmbientScene from "@/components/landing/canvas/AmbientScene";
import { cn } from "@/lib/cn";
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
 * The pathname picks the preset, so navigating changes the tuning without
 * tearing the canvas down.
 */
export function AppAmbient() {
  const preset = presetFor(usePathname());

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
function presetFor(pathname: string): Preset {
  // The dashboard is a landing spot rather than a working surface: nothing on
  // it is being read against a clock, so it gets the object and the full wake.
  if (pathname.startsWith("/dashboard")) {
    return { skull: true, matrix: false, wakeGain: 1, opacity: "opacity-90" };
  }

  // Competition surfaces. Scanned under time pressure, so: no skull moving
  // through the middle of the frame, and a wake at a hundredth — present
  // enough that the page is not dead, quiet enough to ignore.
  if (pathname.startsWith("/ctf") || pathname.startsWith("/leaderboard")) {
    return { skull: false, matrix: true, wakeGain: 0.01, opacity: "opacity-75" };
  }

  // Everything else — browsing and administration. No skull over dense lists
  // or forms, but the wake is worth more here than in a live event.
  return { skull: false, matrix: false, wakeGain: 0.25, opacity: "opacity-[0.55]" };
}
