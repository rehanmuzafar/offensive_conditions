/**
 * The neon cycle.
 *
 * The scene's accent colour is never fixed: it drifts continuously through a
 * ring of neon stops, so the same shot looks electric blue, then violet, then
 * acid green a minute later. Two colours are published — a lead and a trail one
 * step behind it — because a single hue flattens the scene, whereas a pair
 * gives every shader something to interpolate across and keeps the frame
 * reading as lit rather than tinted.
 *
 * There is exactly one writer (the driver inside the canvas) and every shader
 * reads the same values, which is the point: if the grid and the data field
 * cycled on their own timers they would drift apart within a minute and the
 * scene would stop looking like one space.
 */

export type Rgb = [number, number, number];

/**
 * Ring of stops, in linear-ish sRGB. Deliberately saturated — these are read
 * through glass and against black, both of which eat chroma.
 */
const STOPS: Rgb[] = [
  [0.18, 0.36, 1.0], // electric blue
  [0.55, 0.36, 0.97], // violet — the brand anchor
  [0.94, 0.67, 0.99], // magenta
  [0.13, 0.83, 0.93], // cyan
  [0.64, 0.9, 0.21], // acid green
];

/** Seconds spent travelling from one stop to the next. Five stops → ~48s ring. */
const SECONDS_PER_STOP = 9.6;

export const neon = {
  /** Position around the ring, in stops. Wraps at STOPS.length. */
  phase: 0,
  /** Current colour. Seeded to the first stop; overwritten on frame one. */
  lead: [0.18, 0.36, 1.0] as Rgb,
  /** One stop behind the lead — the shadow/secondary accent. */
  trail: [0.64, 0.9, 0.21] as Rgb,
};

function sampleRing(position: number, out: Rgb) {
  const n = STOPS.length;
  const wrapped = ((position % n) + n) % n;
  const i = Math.floor(wrapped);
  const a = STOPS[i];
  const b = STOPS[(i + 1) % n];
  // Both indices are inside the ring by construction — `wrapped` is already
  // modulo n. The guard exists so this reads without a non-null assertion, not
  // because either can actually be missing.
  if (!a || !b) return;

  // Smoothstep between stops so the ring has no visible corners — a linear
  // ramp reads as a colour "arriving" on a beat, which fights the drift.
  const t = wrapped - i;
  const e = t * t * (3 - 2 * t);

  out[0] = a[0] + (b[0] - a[0]) * e;
  out[1] = a[1] + (b[1] - a[1]) * e;
  out[2] = a[2] + (b[2] - a[2]) * e;
}

/** Called once per frame by the driver. */
export function advanceNeon(dt: number) {
  neon.phase += dt / SECONDS_PER_STOP;
  sampleRing(neon.phase, neon.lead);
  sampleRing(neon.phase - 1, neon.trail);
}
