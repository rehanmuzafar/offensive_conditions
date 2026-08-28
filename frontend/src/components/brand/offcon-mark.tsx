"use client";

/**
 * The OFFCON wordmark.
 *
 * The letters are Sansation Bold as outlines and the O is the skull — the same
 * contour the 3D object extrudes, so the flat mark and the one turning on the
 * landing page are one shape rather than two drawings to keep in step. The
 * paths come from `public/brand/offcon-logo.svg`, which is generated from the
 * font; edit that, not this.
 *
 * Inline rather than an <img>: as markup the letters inherit `currentColor`, so
 * one component serves the dark shells and the light theme without a second
 * file, and the skull keeps its own gradient either way.
 */

import { cn } from "@/lib/cn";

/** Intrinsic aspect ratio of the artwork, used to size by height alone. */
const VIEWBOX = "0 0 8763 1699";
const RATIO = 5.1577;

export function OffconMark({
  label,
  height = 26,
  className,
  wordmark = true,
}: {
  /** Surface name shown after the wordmark, e.g. "CTF". */
  label?: string;
  /** Height in px; width follows the artwork's ratio. */
  height?: number;
  className?: string;
  /** Off where only the skull fits. */
  wordmark?: boolean;
}) {
  if (!wordmark) {
    return <SkullOnly height={height} className={className} />;
  }

  return (
    <span className={cn("flex items-baseline gap-2", className)}>
      <svg
        viewBox={VIEWBOX}
        height={height}
        width={height * RATIO}
        role="img"
        aria-label="OFFCON"
        className="shrink-0"
      >
        <defs>
          <linearGradient id="offcon-skull-mark" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#C8B4FF"/>
      <stop offset="1" stopColor="#7C3AED"/>
    </linearGradient>
        </defs>
        <g transform="translate(110 1550.00) scale(1 -1)" fill="currentColor">
    <path transform="translate(0 0)" d="M818 220Q1250 220 1250 719Q1250 1210 818 1210Q375 1210 375 719Q375 220 818 220ZM100 713Q100 1440 818 1440Q1525 1440 1525 713Q1525 -10 818 -10Q132 -10 100 713Z"/>
    <path transform="translate(1625 0)" d="M1089 1430V1202H413V842H1055V605H410V0H150V1430Z"/>
    <path transform="translate(2789 0)" d="M1089 1430V1202H413V842H1055V605H410V0H150V1430Z"/>
    <path transform="translate(3953 0)" d="M1290 60Q1105 -10 870 -10Q100 -10 100 735Q100 1440 870 1440Q1105 1440 1290 1370V1130Q1105 1210 890 1210Q375 1210 375 735Q375 220 890 220Q1105 220 1290 300Z"/>
    <path fill="url(#offcon-skull-mark)" fillRule="evenodd"
          transform="translate(6155.50 665.82) scale(620.9850 -620.9850)"
          d="M0 -1.2C0.62 -1.2 1.02 -0.88 1.02 -0.34C1.02 -0.02 0.96 0.16 0.9 0.3C0.82 0.46 0.7 0.57 0.57 0.61L0.5325 0.66C0.5325 0.91 0.3475 0.91 0.3475 0.66L0.3125 0.66C0.3125 1.035 0.1275 1.035 0.1275 0.66L0.0925 0.66C0.0925 1.135 -0.0925 1.135 -0.0925 0.66L-0.1275 0.66C-0.1275 1.0225 -0.3125 1.0225 -0.3125 0.66L-0.3475 0.66C-0.3475 0.8975 -0.5325 0.8975 -0.5325 0.66L-0.57 0.61C-0.7 0.57 -0.82 0.46 -0.9 0.3C-0.96 0.16 -1.02 -0.02 -1.02 -0.34C-1.02 -0.88 -0.62 -1.2 0 -1.2ZM-0.45 -0.47 L-0.1642 -0.305 L-0.1642 0.025 L-0.45 0.19 L-0.7358 0.025 L-0.7358 -0.305 ZM0.45 -0.47 L0.7358 -0.305 L0.7358 0.025 L0.45 0.19 L0.1642 0.025 L0.1642 -0.305 ZM0 0.21Q0.07 0.34 0.1 0.47Q0 0.4284 -0.1 0.47Q-0.07 0.34 0 0.21Z"/>
    <path transform="translate(6968 0)" d="M150 0V1430H415L1170 388V1430H1425V0H1160L405 1064V0Z"/>
  </g>
      </svg>
      {label && (
        <span
          className="font-display text-[13px] font-semibold uppercase tracking-wide text-text-faint"
          style={{ fontSize: Math.max(10, height * 0.46) }}
        >
          {label}
        </span>
      )}
    </span>
  );
}

/**
 * Just the skull, for places too narrow for the word — a 68px rail, a favicon.
 */
function SkullOnly({ height, className }: { height: number; className?: string }) {
  return (
    <svg
      viewBox="-1.15 -1.3 2.3 2.45"
      height={height}
      width={height}
      role="img"
      aria-label="OFFCON"
      className={cn("shrink-0", className)}
    >
      <defs>
        <linearGradient id="offcon-skull-only" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#C8B4FF"/>
      <stop offset="1" stopColor="#7C3AED"/>
    </linearGradient>
      </defs>
      <path fill="url(#offcon-skull-only)" fillRule="evenodd" d="M0 -1.2C0.62 -1.2 1.02 -0.88 1.02 -0.34C1.02 -0.02 0.96 0.16 0.9 0.3C0.82 0.46 0.7 0.57 0.57 0.61L0.5325 0.66C0.5325 0.91 0.3475 0.91 0.3475 0.66L0.3125 0.66C0.3125 1.035 0.1275 1.035 0.1275 0.66L0.0925 0.66C0.0925 1.135 -0.0925 1.135 -0.0925 0.66L-0.1275 0.66C-0.1275 1.0225 -0.3125 1.0225 -0.3125 0.66L-0.3475 0.66C-0.3475 0.8975 -0.5325 0.8975 -0.5325 0.66L-0.57 0.61C-0.7 0.57 -0.82 0.46 -0.9 0.3C-0.96 0.16 -1.02 -0.02 -1.02 -0.34C-1.02 -0.88 -0.62 -1.2 0 -1.2ZM-0.45 -0.47 L-0.1642 -0.305 L-0.1642 0.025 L-0.45 0.19 L-0.7358 0.025 L-0.7358 -0.305 ZM0.45 -0.47 L0.7358 -0.305 L0.7358 0.025 L0.45 0.19 L0.1642 0.025 L0.1642 -0.305 ZM0 0.21Q0.07 0.34 0.1 0.47Q0 0.4284 -0.1 0.47Q-0.07 0.34 0 0.21Z"/>
    </svg>
  );
}
