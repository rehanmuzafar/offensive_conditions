"use client";

import { useEffect, useState } from "react";

import AmbientScene from "@/components/landing/canvas/AmbientScene";
import PointerTracker from "@/components/landing/PointerTracker";
import { burstRipple } from "@/components/landing/lib/ripples";
import {
  CAPTION,
  VERDICT_MS,
  clearVerdict,
  onVerdict,
  peekVerdict,
  type Verdict,
} from "@/components/landing/lib/verdict";
import { cn } from "@/lib/cn";

/**
 * The skull that watches you solve.
 *
 * Anchored off to the right so it leans into frame beside the open challenge
 * rather than sitting behind it — the panel is on the left, the reaction is on
 * the right, and neither is reading the other's space. The scene is the
 * cut-down ambient build with the wake left at CTF strength, because the only
 * ripple that should register here is the one a correct flag fires.
 *
 * It is mounted by the solver for as long as a challenge is open and unmounts
 * with it, which is also what resets the verdict state. The already-solved
 * announcement is driven by the solver through `useAnnounceSolved`, not by a
 * prop here — the solver is the thing that knows when the challenge data has
 * actually settled.
 */
export function ChallengeVerdictScene({
  /**
   * Where the scene sits in the host's stacking order. It has to land above
   * the host's backdrop and below its panel, and those layers differ between
   * the centred solver and the left drawer — so the host names the layer
   * rather than this guessing one that happens to work in a single caller.
   */
  layerClassName = "z-0",
}: {
  layerClassName?: string;
} = {}) {
  const [phase, setPhase] = useState<Verdict>("idle");

  useEffect(() => onVerdict(setPhase), []);

  useEffect(() => {
    peekVerdict();
    return () => clearVerdict();
  }, []);

  /**
   * One ripple, centre screen, the moment a flag lands.
   *
   * Fired here rather than from the state machine so the effect belongs to the
   * thing that draws it — and once, not per frame: `burstRipple` bypasses the
   * pointer's spacing rule, so calling it in a loop would stack rings into a
   * blob.
   */
  useEffect(() => {
    if (phase !== "correct") return;
    const now = performance.now() / 1000;
    burstRipple(0.5, 0.5, now);
  }, [phase]);

  const caption =
    phase === "wrong" || phase === "correct" || phase === "solved" ? CAPTION[phase] : null;

  /**
   * The exit ends inside the eye socket, and the fade has to wait for it.
   *
   * Fading the instant the flag lands hid the whole celebration: the spin only
   * begins at 45% of the sequence and the dive after it, so by the time the
   * skull did anything the canvas had been at zero opacity for a second. The
   * fade now starts once the dive is nearly home and finishes with it.
   */
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (phase !== "correct") {
      setLeaving(false);
      return;
    }
    const t = setTimeout(() => setLeaving(true), VERDICT_MS.correct * 0.82);
    return () => clearTimeout(t);
  }, [phase]);

  return (
    <>
      <PointerTracker />
      <AmbientScene
        skull
        /* No `faceForward`: that pose belongs to the sign-in cinematic, where
           the skull is the subject and must look straight down the lens. Here
           it is a bystander to the player's work, so it turns to follow the
           pointer like the dashboard's does. */
        wakeGain={phase === "correct" ? 0.9 : 0.01}
        /* Off to the right, and a little back, so the challenge panel on the
           left keeps its own space. */
        anchor={[2.3, -0.1, -0.8]}
        /* Above the host's backdrop, below its panel. Negative z would put it
           behind the page again — which is how this went invisible before. */
        className={cn(
          "pointer-events-none absolute inset-0 transition-opacity duration-[700ms]",
          layerClassName,
          leaving ? "opacity-0" : "opacity-90",
        )}
      />

      {caption && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[12%] z-40 flex justify-center px-6 lg:left-1/2 lg:right-8 lg:justify-end">
          <p
            className={cn(
              "glass-strong max-w-[420px] px-5 py-3 text-center font-display text-[15px] font-bold tracking-mega",
              phase === "wrong" && "border-danger/50 text-danger",
              phase === "correct" && "border-success/50 text-success",
              phase === "solved" && "text-text-dim",
            )}
          >
            {caption}
          </p>
        </div>
      )}
    </>
  );
}

/**
 * Announces an already-solved challenge once, on open.
 *
 * Separated from the scene so the solver can call it at the moment it knows the
 * answer, rather than the scene guessing from a prop it was handed before the
 * data settled.
 */
export function useAnnounceSolved(alreadySolved: boolean, play: () => void) {
  useEffect(() => {
    if (!alreadySolved) return;
    const id = setTimeout(play, 500);
    return () => clearTimeout(id);
  }, [alreadySolved, play]);
}
