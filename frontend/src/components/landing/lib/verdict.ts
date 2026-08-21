/**
 * The skull's reaction to a flag submission.
 *
 * Same shape as the sign-in transition and for the same reason: the WebGL skull
 * reads this inside `useFrame` sixty times a second, while the DOM only needs
 * to know which of five states it is in. A React store would re-render the tree
 * on every frame the canvas cares about; a mutable object plus a small
 * subscription gives the canvas a free read and the DOM exactly the updates it
 * needs.
 */

export type Verdict =
  /** Nothing open. */
  | "idle"
  /** A challenge is open; the skull leans in from the right and waits. */
  | "peek"
  /** Wrong flag: it shakes its head, eyes go red. */
  | "wrong"
  /** Correct: ripple, celebration, then it dives into its own eye and is gone. */
  | "correct"
  /** Opened something already solved. */
  | "solved";

/** Milliseconds each reaction runs before settling back to `peek`. */
export const VERDICT_MS: Record<Exclude<Verdict, "idle" | "peek">, number> = {
  wrong: 2200,
  /* Long, because three things happen in sequence: celebrate, spin, dive. */
  correct: 4200,
  solved: 3000,
};

export const CAPTION: Record<Exclude<Verdict, "idle" | "peek">, string> = {
  wrong: "Sorry — wrong flag.",
  correct: "Congratulations, you solved the challenge.",
  solved: "You already solved this challenge.",
};

export const verdict = {
  phase: "idle" as Verdict,
  /** 0→1 across the current reaction. */
  progress: 0,
  startedAt: 0,
};

type Listener = (phase: Verdict) => void;
const listeners = new Set<Listener>();

export function onVerdict(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function setPhase(next: Verdict) {
  verdict.phase = next;
  for (const fn of listeners) fn(next);
}

let raf = 0;

/** Opens the scene: the skull leans in and waits for an answer. */
export function peekVerdict() {
  cancelAnimationFrame(raf);
  verdict.progress = 0;
  setPhase("peek");
}

/** Closes it. */
export function clearVerdict() {
  cancelAnimationFrame(raf);
  verdict.progress = 0;
  setPhase("idle");
}

/**
 * Plays a reaction. `wrong` and `solved` fall back to `peek` so the skull stays
 * available for the next attempt; `correct` does not — it ends by leaving.
 */
export function playVerdict(next: Exclude<Verdict, "idle" | "peek">) {
  cancelAnimationFrame(raf);
  verdict.startedAt = performance.now();
  verdict.progress = 0;
  setPhase(next);

  const duration = VERDICT_MS[next];
  const tick = () => {
    const elapsed = performance.now() - verdict.startedAt;
    verdict.progress = Math.min(1, elapsed / duration);
    if (verdict.progress < 1) {
      raf = requestAnimationFrame(tick);
    } else if (next !== "correct") {
      setPhase("peek");
    }
  };
  raf = requestAnimationFrame(tick);
}
