"use client";

import { useEffect, useState } from "react";

import { onPhase, resetTransition, type TransitionPhase } from "@/components/landing/lib/transition";

/**
 * The DOM half of the sign-in cinematic.
 *
 * The WebGL half — ripple, then the skull rushing the camera until an eye
 * socket fills the frame — is driven from the same phase clock in
 * `lib/transition`. This layer only does what the canvas cannot: dim the form
 * out of the way, close the frame to black behind the socket, and resolve the
 * greeting.
 *
 * It is deliberately not a router guard. Navigation is the caller's business;
 * this component just reflects the phase, so a failed sign-in that never starts
 * the sequence leaves the page exactly as it was.
 */
const GREETING = "WELCOME TO DARKNESS";

export function SignInTransition() {
  const [phase, setPhase] = useState<TransitionPhase>("idle");

  useEffect(() => onPhase(setPhase), []);

  // A component that unmounts mid-sequence (fast navigation, a back button)
  // would otherwise leave the shared phase stuck and the skull parked at 26x.
  useEffect(() => () => resetTransition(), []);

  if (phase === "idle") return null;

  const diving = phase === "dive" || phase === "dark" || phase === "done";
  const dark = phase === "dark" || phase === "done";

  return (
    <div className="pointer-events-none fixed inset-0 z-[80]">
      {/* Closes to black from the edges inward, so the last thing still lit is
          the middle of the frame — which is where the socket is heading. */}
      <div
        className="absolute inset-0 bg-black transition-opacity ease-in"
        style={{
          opacity: dark ? 1 : diving ? 0.55 : 0,
          transitionDuration: dark ? "700ms" : "1200ms",
        }}
      />

      {dark && (
        <div className="absolute inset-0 grid place-items-center">
          <h2 className="flex flex-wrap justify-center px-6 font-display text-[clamp(22px,5vw,58px)] font-extrabold uppercase tracking-mega">
            {GREETING.split("").map((ch, i) => (
              <span
                key={i}
                className="inline-block animate-fade-up"
                style={{
                  // Letter by letter, ~28ms apart: fast enough to read as one
                  // phrase arriving, slow enough to feel deliberate.
                  animationDelay: `${i * 28}ms`,
                  animationFillMode: "both",
                  whiteSpace: ch === " " ? "pre" : undefined,
                }}
              >
                {ch === " " ? " " : ch}
              </span>
            ))}
          </h2>
        </div>
      )}
    </div>
  );
}

/**
 * Fades and locks the sign-in form while the sequence runs. Wrapped around the
 * card rather than applied inside it so nothing in the form needs to know the
 * transition exists.
 */
export function SignInFormFade({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<TransitionPhase>("idle");
  useEffect(() => onPhase(setPhase), []);

  const running = phase !== "idle";

  return (
    <div
      className="transition-all duration-700 ease-out"
      style={{
        opacity: running ? 0 : 1,
        transform: running ? "scale(0.97)" : "none",
        filter: running ? "blur(6px)" : "none",
        pointerEvents: running ? "none" : undefined,
      }}
    >
      {children}
    </div>
  );
}
