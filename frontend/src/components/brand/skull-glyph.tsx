/**
 * The OFFCON skull as a flat glyph.
 *
 * The path is the same contour `createSkullShape()` extrudes for the 3D object
 * — cranium, hexagonal eye sockets, the small nose, and the five digits
 * dripping off the jaw — traced in the same coordinate space and flipped for
 * SVG's downward y. skullGeometry.ts calls this out as an intended use: the
 * outline is exported "available for any 2D echo of the mark".
 *
 * Not the brand PNG: `offcon-mark.png` is a circular disc with the skull drawn
 * inside it, so masking with it yields a circle. This is the silhouette itself,
 * which is what lets it take a colour.
 */
export function SkullGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="-1.15 -1.3 2.3 2.1"
      aria-hidden
      focusable="false"
      className={className}
      fill="currentColor"
      /* evenodd, so the eye and nose contours read as holes rather than
         painting over the skull. */
      fillRule="evenodd"
    >
      <path d="M0 -1.2C0.62 -1.2 1.02 -0.88 1.02 -0.34C1.02 -0.02 0.96 0.16 0.9 0.3C0.82 0.46 0.7 0.57 0.57 0.61L0.5325 0.66C0.5325 0.91 0.3475 0.91 0.3475 0.66L0.3125 0.66C0.3125 1.035 0.1275 1.035 0.1275 0.66L0.0925 0.66C0.0925 1.135 -0.0925 1.135 -0.0925 0.66L-0.1275 0.66C-0.1275 1.0225 -0.3125 1.0225 -0.3125 0.66L-0.3475 0.66C-0.3475 0.8975 -0.5325 0.8975 -0.5325 0.66L-0.57 0.61C-0.7 0.57 -0.82 0.46 -0.9 0.3C-0.96 0.16 -1.02 -0.02 -1.02 -0.34C-1.02 -0.88 -0.62 -1.2 0 -1.2ZM-0.45 -0.47 L-0.1642 -0.305 L-0.1642 0.025 L-0.45 0.19 L-0.7358 0.025 L-0.7358 -0.305 ZM0.45 -0.47 L0.7358 -0.305 L0.7358 0.025 L0.45 0.19 L0.1642 0.025 L0.1642 -0.305 ZM0 0.21Q0.07 0.34 0.1 0.47Q0 0.4284 -0.1 0.47Q-0.07 0.34 0 0.21Z" />
    </svg>
  );
}
