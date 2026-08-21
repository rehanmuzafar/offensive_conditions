/**
 * Shared mutable state between the DOM layer and the WebGL layer.
 *
 * Scroll position, pointer position and the live orientation of the hero
 * object are all read every frame. Routing them through React state would
 * re-render the tree 60 times a second, so they live in plain module-level
 * objects that anyone can read and only their owner writes. Components that
 * need to *display* these values (the debug HUD, the scroll ruler) poll them
 * on a throttled rAF instead of subscribing.
 */

export type Vec2 = { x: number; y: number };

/** Written by the Lenis loop in <SmoothScroll>. */
export const scroll = {
  /** 0 at the top of the document, 1 at the very bottom. */
  progress: 0,
  /** Pixels scrolled. */
  y: 0,
  /** Signed px/frame, useful for stretching geometry into the direction of travel. */
  velocity: 0,
};

/** Written by the global pointermove listener in <PointerTracker>. */
export const pointer = {
  /** Raw, normalised to -1..1 with origin at viewport centre. */
  raw: { x: 0, y: 0 } as Vec2,
  /** Critically damped follow of `raw` — this is what the scene should use. */
  smooth: { x: 0, y: 0 } as Vec2,
  /** True once the user has actually moved a pointer (suppresses the idle drift). */
  active: false,
};

/** Written by the glass skull each frame. Now read only through the
 *  `window.__offcon` debug handle at the bottom of this file — keep the fps
 *  counter in particular, it is the only way to check frame rate by hand. */
export const heroTelemetry = {
  quaternion: [0, 0, 0, 1] as [number, number, number, number],
  roughness: 0.08,
  thickness: 1.6,
  dispersion: 0.42,
  /** Frames per second, sampled over a rolling second. */
  fps: 0,
};

/** Section the scroll ruler should currently highlight. */
export const sections = [
  { id: "top", label: "TOP" },
  { id: "arena", label: "ARENA" },
  { id: "machines", label: "MACHINES" },
  { id: "ladder", label: "LADDER" },
  { id: "enlist", label: "ENLIST" },
] as const;

export type SectionId = (typeof sections)[number]["id"];

/** Frame-rate independent lerp factor. `speed` is roughly "per 60fps frame". */
export function damp(current: number, target: number, speed: number, dt: number) {
  return current + (target - current) * (1 - Math.exp(-speed * dt));
}

export function clamp(v: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, v));
}

/** Maps `v` from [inMin,inMax] onto [0,1], clamped. */
export function range(v: number, inMin: number, inMax: number) {
  if (inMax === inMin) return 0;
  return clamp((v - inMin) / (inMax - inMin));
}

/**
 * Debug handle. None of the values above are reachable from the console
 * otherwise — they are module-private by design — and on a page whose whole
 * behaviour is "numbers changing every frame", not being able to read them
 * live makes every performance question guesswork. Read-only by convention;
 * nothing in the app consumes this.
 */
if (typeof window !== "undefined") {
  (window as unknown as { __offcon?: unknown }).__offcon = {
    scroll,
    pointer,
    heroTelemetry,
    /**
     * Replays the sign-in cinematic on demand. Without it the only way to see
     * the sequence is to actually sign in, which makes every adjustment to its
     * timing a full logout/login round trip — and makes it impossible to check
     * at all from anywhere that cannot type a password.
     */
    playSignIn: () => import("./transition").then((m) => m.playSignInTransition()),
  };
}
