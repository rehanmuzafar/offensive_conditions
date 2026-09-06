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

/** Intrinsic aspect ratios, used to size each variant by height alone. */
const VIEWBOX = "0 0 8763 1699";
const RATIO = 5.1577;

const LOCKUP_VIEWBOX = "0 0 8763 2515";
const LOCKUP_RATIO = 3.4843;

export function OffconMark({
  label,
  height = 26,
  className,
  wordmark = true,
  lockup = false,
}: {
  /** Surface name shown after the wordmark, e.g. "CTF". */
  label?: string;
  /** Height in px; width follows the artwork's ratio. */
  height?: number;
  className?: string;
  /** Off where only the skull fits. */
  wordmark?: boolean;
  /**
   * Stack "OFFENSE CONDITIONS" beneath the wordmark.
   *
   * For places that introduce the brand — the marketing nav, the sign-in
   * page, the footer. Not for a surface bar carrying a label like "CTF":
   * three lines of text in one corner is one too many, and the label is
   * already doing the job of saying where you are.
   */
  lockup?: boolean;
}) {
  if (!wordmark) {
    return <SkullOnly height={height} className={className} />;
  }

  if (lockup) {
    return (
      <svg
        viewBox={LOCKUP_VIEWBOX}
        height={height}
        width={height * LOCKUP_RATIO}
        role="img"
        aria-label="OFFCON — Offense Conditions"
        className={cn("shrink-0", className)}
      >
<defs>
    <linearGradient id="offcon-lockup-skull" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#C8B4FF"/>
      <stop offset="1" stopColor="#7C3AED"/>
    </linearGradient>
  </defs>
        <g fill="currentColor">
{/* wordmark */}
    <g transform="translate(110 1560.00) scale(1 -1)">
      <path transform="translate(0 0)" d="M818 220Q1250 220 1250 719Q1250 1210 818 1210Q375 1210 375 719Q375 220 818 220ZM100 713Q100 1440 818 1440Q1525 1440 1525 713Q1525 -10 818 -10Q132 -10 100 713Z"/>
      <path transform="translate(1625 0)" d="M1089 1430V1202H413V842H1055V605H410V0H150V1430Z"/>
      <path transform="translate(2789 0)" d="M1089 1430V1202H413V842H1055V605H410V0H150V1430Z"/>
      <path transform="translate(3953 0)" d="M1290 60Q1105 -10 870 -10Q100 -10 100 735Q100 1440 870 1440Q1105 1440 1290 1370V1130Q1105 1210 890 1210Q375 1210 375 735Q375 220 890 220Q1105 220 1290 300Z"/>
      <path fill="url(#offcon-lockup-skull)" fillRule="evenodd"
            transform="translate(6155.50 665.82) scale(620.9850 -620.9850)" d="M0 -1.2C0.62 -1.2 1.02 -0.88 1.02 -0.34C1.02 -0.02 0.96 0.16 0.9 0.3C0.82 0.46 0.7 0.57 0.57 0.61L0.5325 0.66C0.5325 0.91 0.3475 0.91 0.3475 0.66L0.3125 0.66C0.3125 1.035 0.1275 1.035 0.1275 0.66L0.0925 0.66C0.0925 1.135 -0.0925 1.135 -0.0925 0.66L-0.1275 0.66C-0.1275 1.0225 -0.3125 1.0225 -0.3125 0.66L-0.3475 0.66C-0.3475 0.8975 -0.5325 0.8975 -0.5325 0.66L-0.57 0.61C-0.7 0.57 -0.82 0.46 -0.9 0.3C-0.96 0.16 -1.02 -0.02 -1.02 -0.34C-1.02 -0.88 -0.62 -1.2 0 -1.2ZM-0.45 -0.47 L-0.1642 -0.305 L-0.1642 0.025 L-0.45 0.19 L-0.7358 0.025 L-0.7358 -0.305 ZM0.45 -0.47 L0.7358 -0.305 L0.7358 0.025 L0.45 0.19 L0.1642 0.025 L0.1642 -0.305 ZM0 0.21Q0.07 0.34 0.1 0.47Q0 0.4284 -0.1 0.47Q-0.07 0.34 0 0.21Z"/>
      <path transform="translate(6968 0)" d="M150 0V1430H415L1170 388V1430H1425V0H1160L405 1064V0Z"/>
    </g>
    {/* descriptor */}
    <g transform="translate(110 2405.40) scale(1 -1)" opacity="0.72">
      <path transform="translate(0.00 0) scale(0.2850)" d="M838 140Q1350 140 1350 719Q1350 1290 838 1290Q315 1290 315 719Q315 140 838 140ZM120 713Q120 1440 838 1440Q1545 1440 1545 713Q1545 -10 838 -10Q120 -10 120 713Z"/>
      <path transform="translate(591.31 0) scale(0.2850)" d="M1105 1430V1280H355V800H1070V650H355V0H170V1430Z"/>
      <path transform="translate(1037.27 0) scale(0.2850)" d="M1105 1430V1280H355V800H1070V650H355V0H170V1430Z"/>
      <path transform="translate(1483.23 0) scale(0.2850)" d="M1105 1430V1280H355V800H1070V650H355V150H1120V0H170V1430Z"/>
      <path transform="translate(1950.57 0) scale(0.2850)" d="M170 0V1430H355L1230 278V1430H1405V0H1220L345 1162V0Z"/>
      <path transform="translate(2516.23 0) scale(0.2850)" d="M150 50V220Q375 140 636 140Q1005 140 1005 410Q1005 640 733 640H549Q100 640 100 1030Q100 1440 675 1440Q925 1440 1140 1380V1210Q925 1290 675 1290Q285 1290 285 1030Q285 800 549 800H733Q1190 800 1190 410Q1190 -10 636 -10Q375 -10 150 50Z"/>
      <path transform="translate(3000.66 0) scale(0.2850)" d="M1105 1430V1280H355V800H1070V650H355V150H1120V0H170V1430Z"/>
      <path transform="translate(3784.08 0) scale(0.2850)" d="M1250 50Q1065 -10 850 -10Q100 -10 100 735Q100 1440 850 1440Q1065 1440 1250 1380V1220Q1065 1290 870 1290Q285 1290 285 735Q285 140 870 140Q1065 140 1250 210Z"/>
      <path transform="translate(4295.59 0) scale(0.2850)" d="M838 140Q1350 140 1350 719Q1350 1290 838 1290Q315 1290 315 719Q315 140 838 140ZM120 713Q120 1440 838 1440Q1545 1440 1545 713Q1545 -10 838 -10Q120 -10 120 713Z"/>
      <path transform="translate(4886.90 0) scale(0.2850)" d="M170 0V1430H355L1230 278V1430H1405V0H1220L345 1162V0Z"/>
      <path transform="translate(5452.56 0) scale(0.2850)" d="M690 150Q1215 150 1215 754Q1215 1280 690 1280H355V150ZM170 0V1430H690Q1400 1430 1400 754Q1400 0 690 0Z"/>
      <path transform="translate(5996.85 0) scale(0.2850)" d="M385 1430V0H200V1430Z"/>
      <path transform="translate(6280.36 0) scale(0.2850)" d="M1135 1430V1280H685V0H500V1280H50V1430Z"/>
      <path transform="translate(6734.87 0) scale(0.2850)" d="M385 1430V0H200V1430Z"/>
      <path transform="translate(7018.38 0) scale(0.2850)" d="M838 140Q1350 140 1350 719Q1350 1290 838 1290Q315 1290 315 719Q315 140 838 140ZM120 713Q120 1440 838 1440Q1545 1440 1545 713Q1545 -10 838 -10Q120 -10 120 713Z"/>
      <path transform="translate(7609.69 0) scale(0.2850)" d="M170 0V1430H355L1230 278V1430H1405V0H1220L345 1162V0Z"/>
      <path transform="translate(8175.35 0) scale(0.2850)" d="M150 50V220Q375 140 636 140Q1005 140 1005 410Q1005 640 733 640H549Q100 640 100 1030Q100 1440 675 1440Q925 1440 1140 1380V1210Q925 1290 675 1290Q285 1290 285 1030Q285 800 549 800H733Q1190 800 1190 410Q1190 -10 636 -10Q375 -10 150 50Z"/>
    </g>
        </g>
      </svg>
    );
  }

  return (
    <span className={cn("flex items-center", className)}>
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
        <>
          {/* A rule, not a gap. Set beside the wordmark with only space between
              them the label read as a stray word; the divider says the two are
              one lockup and the label names this surface. */}
          <span
            aria-hidden
            className="shrink-0 self-stretch border-l border-line-strong"
            style={{ marginInline: height * 0.34 }}
          />
          <span
            className="whitespace-nowrap font-display font-semibold uppercase text-text-dim"
            style={{
              // 0.72 of the mark's height, against 0.46 before. The label is a
              // sibling of the wordmark rather than a footnote to it, and at
              // twelve pixels beside a twenty-six pixel logo it read as one.
              fontSize: Math.max(13, height * 0.72),
              letterSpacing: "0.06em",
            }}
          >
            {label}
          </span>
        </>
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
