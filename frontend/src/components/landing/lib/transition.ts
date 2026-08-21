/**
 * The sign-in transition.
 *
 * A short cinematic that runs after a successful login: a ripple opens at the
 * centre of the screen, the skull rushes the camera until one eye socket fills
 * the frame, the form fades out, and the greeting resolves inside the dark.
 *
 * The state lives here rather than in a React store because two very different
 * consumers need it on the same frame: the WebGL skull (which reads it inside
 * `useFrame`, sixty times a second) and a DOM overlay (which only needs to know
 * which phase it is in). A zustand store would re-render the React tree on every
 * phase change; a mutable object plus a tiny subscription gives the canvas a
 * free read and the DOM exactly the four updates it cares about.
 */

export type TransitionPhase =
  /** Nothing happening — the normal state of the page. */
  | "idle"
  /** Ripple expanding from the centre; the skull begins to move. */
  | "ripple"
  /** Skull rushing the camera, eye socket opening up. */
  | "dive"
  /** Inside the socket. Greeting resolves. */
  | "dark"
  /** Handing off to the router. */
  | "done";

/** Seconds each phase lasts. The total is what the caller waits before routing. */
export const PHASE_MS: Record<Exclude<TransitionPhase, "idle" | "done">, number> = {
  ripple: 1100,
  dive: 1500,
  dark: 3200,
};

export const TOTAL_MS = PHASE_MS.ripple + PHASE_MS.dive + PHASE_MS.dark;

/** Read every frame by the canvas. */
export const transition = {
  phase: "idle" as TransitionPhase,
  /** 0→1 across the *whole* sequence, for anything that wants one clean ramp. */
  progress: 0,
  /** Wall-clock start, so progress survives a dropped frame. */
  startedAt: 0,
};

type Listener = (phase: TransitionPhase) => void;
const listeners = new Set<Listener>();

/** Subscribe to phase changes. Returns an unsubscribe suitable for a React
 *  effect cleanup — `Set.delete` returns a boolean, which useEffect rejects. */
export function onPhase(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function setPhase(next: TransitionPhase) {
  transition.phase = next;
  for (const fn of listeners) fn(next);
}

let raf = 0;

/**
 * Starts the sequence. Returns a promise that resolves when it is over, so the
 * caller can `await` it and then navigate.
 */
export function playSignInTransition(): Promise<void> {
  if (transition.phase !== "idle") return Promise.resolve();

  transition.startedAt = performance.now();
  transition.progress = 0;
  setPhase("ripple");

  const tick = () => {
    const elapsed = performance.now() - transition.startedAt;
    transition.progress = Math.min(1, elapsed / TOTAL_MS);

    const next: TransitionPhase =
      elapsed < PHASE_MS.ripple
        ? "ripple"
        : elapsed < PHASE_MS.ripple + PHASE_MS.dive
          ? "dive"
          : elapsed < TOTAL_MS
            ? "dark"
            : "done";

    if (next !== transition.phase) setPhase(next);
    if (next !== "done") raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return new Promise((resolve) => setTimeout(resolve, TOTAL_MS));
}

/** Used when a component unmounts mid-sequence (e.g. fast navigation). */
export function resetTransition() {
  cancelAnimationFrame(raf);
  transition.progress = 0;
  setPhase("idle");
}
