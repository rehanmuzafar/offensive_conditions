"use client";

import AmbientScene from "@/components/landing/canvas/AmbientScene";
import PointerTracker from "@/components/landing/PointerTracker";

/**
 * The scene as CTF surfaces get it.
 *
 * These pages — the arena, an event, the play view, a scoreboard — are read
 * under time pressure, often while something on them is changing. That rules
 * out the two things the scene does most loudly elsewhere:
 *
 *   No skull. It is a large object that moves through the middle of the frame;
 *   on a page where a scoreboard is being scanned it is something to look past
 *   rather than something to enjoy.
 *
 *   Wake at 1%. The pointer ripple stays, because losing it entirely makes the
 *   page feel dead compared to the rest of the product — but at a hundredth of
 *   its marketing strength it registers as the surface being alive, not as
 *   something demanding attention.
 *
 * What is kept is everything that is atmosphere rather than event: the matrix
 * field, the ruled grid, the drifting motes, and the neon cycle tinting all of
 * it. Settings live here rather than at each call site so the four CTF surfaces
 * cannot drift apart.
 */
export function CtfAmbient() {
  return (
    <>
      <PointerTracker />
      <AmbientScene
        skull={false}
        matrix
        wakeGain={0.01}
        /* Below the app layout's opaque ground would make it invisible; see the
           note on the dashboard's scene. */
        className="pointer-events-none fixed inset-0 -z-[1] opacity-75"
      />
    </>
  );
}
