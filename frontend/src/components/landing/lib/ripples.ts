/**
 * The pointer's wake.
 *
 * Dragging a finger through water leaves a line that keeps spreading after the
 * finger has gone. That is not something a single "cursor position" uniform can
 * express, so the pointer drops a breadcrumb every few pixels and the shaders
 * draw an expanding ring at each one, faded by its age. Enough breadcrumbs in a
 * row and the rings merge into a travelling wake along the path.
 *
 * Coordinates are normalised screen space (0..1, y up from the bottom, matching
 * gl_FragCoord) so the wake lands exactly under the cursor no matter what
 * geometry it is drawn on.
 */

/**
 * Ring buffer size, and the single biggest frame-time knob on the page.
 *
 * Every slot costs a `length()` and a `sin()` per pixel, in every shader that
 * draws the wake, for every pass — and the transmission material renders the
 * scene a second time, so the real multiplier is double what it looks like.
 * Eight breadcrumbs is still enough for a continuous wake at normal pointer
 * speeds; the difference only shows on a very fast flick, where the trail is
 * moving too quickly to inspect anyway.
 */
export const RIPPLE_COUNT = 8;

/** How long a single ripple takes to fade out completely, in seconds. */
export const RIPPLE_LIFETIME = 3.4;

/** Minimum pointer travel, in normalised units, before a new ripple is laid
 *  down. Without it a slow drag stacks dozens of ripples in one spot and the
 *  wake reads as a blob. */
const MIN_SPACING = 0.028;

type Ripple = { x: number; y: number; born: number };

const slots: Ripple[] = Array.from({ length: RIPPLE_COUNT }, () => ({
  x: 0,
  y: 0,
  // Born far enough in the past to be fully faded on the first frame.
  born: -RIPPLE_LIFETIME * 10,
}));

let next = 0;
let lastX = -1;
let lastY = -1;

/** Flat [x, y, age, ...] buffer handed to shaders; reused, never reallocated. */
export const rippleBuffer = new Float32Array(RIPPLE_COUNT * 3);

/** Called from the pointer listener with normalised screen coordinates. */
export function dropRipple(x: number, y: number, now: number) {
  if (lastX >= 0) {
    const dx = x - lastX;
    const dy = y - lastY;
    if (dx * dx + dy * dy < MIN_SPACING * MIN_SPACING) return;
  }

  lastX = x;
  lastY = y;

  const slot = slots[next];
  if (!slot) return;

  slot.x = x;
  slot.y = y;
  slot.born = now;
  next = (next + 1) % RIPPLE_COUNT;
}

/**
 * Drops a ripple regardless of how far the pointer has travelled.
 *
 * `dropRipple` deliberately refuses to stack rings in one spot — that is what
 * keeps a slow drag from turning into a blob. A deliberate burst wants exactly
 * the opposite, so it takes this door instead of loosening the spacing rule for
 * everyone.
 */
export function burstRipple(x: number, y: number, now: number) {
  const slot = slots[next];
  if (!slot) return;

  slot.x = x;
  slot.y = y;
  slot.born = now;
  next = (next + 1) % RIPPLE_COUNT;
}

/** Called once per frame; refreshes the ages in the shared buffer. */
export function packRipples(now: number) {
  for (const [i, r] of slots.entries()) {
    rippleBuffer[i * 3 + 0] = r.x;
    rippleBuffer[i * 3 + 1] = r.y;
    // Normalised age: 0 the instant it is dropped, 1 once it has faded out.
    // Clamped rather than left to grow so the shader can trust the range.
    rippleBuffer[i * 3 + 2] = Math.min(1, (now - r.born) / RIPPLE_LIFETIME);
  }
  return rippleBuffer;
}
