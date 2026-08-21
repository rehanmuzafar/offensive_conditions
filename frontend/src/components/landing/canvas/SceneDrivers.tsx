"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { advanceNeon } from "@/components/landing/lib/palette";
import { packRipples, burstRipple } from "@/components/landing/lib/ripples";
import { transition } from "@/components/landing/lib/transition";

/**
 * Advances the values that several shaders share, once per frame, before any
 * of them read them.
 *
 * The negative priority is the whole point: R3F runs `useFrame` callbacks in
 * ascending priority order, so this lands ahead of every material update in the
 * scene. Without it the grid and the rain could pick up the neon colour from
 * different frames — a one-frame skew that is invisible in a still and reads as
 * a flicker in motion.
 */
/**
 * Longest frame the palette is allowed to advance by, in seconds.
 *
 * A backgrounded tab has its animation frames throttled to near zero; the first
 * frame after it comes back carries the entire gap as one delta. Fed straight
 * into the cycle that jumps the accent colour a third of the way around the
 * ring in a single frame — observed here going from violet to cyan-green
 * instantly on refocus. Clamping means a long absence resumes from where it
 * paused instead, which is both less jarring and what "the colour is slowly
 * drifting" implies.
 */
const MAX_STEP = 1 / 20;

/** Seconds between the rings that make up the sign-in burst. */
const BURST_INTERVAL = 0.11;

export default function SceneDrivers() {
  const lastBurst = useRef(0);

  useFrame((_, dt) => {
    advanceNeon(Math.min(dt, MAX_STEP));

    const now = performance.now() / 1000;

    // The sign-in ripple. Several rings a tenth of a second apart read as one
    // disturbance spreading outward; a single ring reads as a blip.
    if (transition.phase === "ripple" && now - lastBurst.current > BURST_INTERVAL) {
      lastBurst.current = now;
      burstRipple(0.5, 0.5, now);
    }

    packRipples(now);
  }, -1);

  return null;
}
