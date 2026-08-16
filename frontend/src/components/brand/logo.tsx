/**
 * <Logo /> — the single source of the brand mark across the whole app.
 *
 * Behaviour:
 *   - If BRAND.logo / BRAND.logoMark are set (in src/config/brand.ts) it renders
 *     YOUR image from /public.
 *   - If they're null (default), it renders the built-in inline SVG placeholder
 *     — the same shield + "OFFCON" wordmark from the approved mockup — which
 *     works crisply on both dark and light themes.
 *
 * To swap in the real logo: edit ONLY src/config/brand.ts. Nothing here.
 */

import Link from "next/link";
import Image from "next/image";

import { BRAND } from "@/config/brand";
import { cn } from "@/lib/cn";

interface LogoProps {
  /** "full" = shield + wordmark, "mark" = shield only. */
  variant?: "full" | "mark";
  /** Height in px (width auto). */
  size?: number;
  /** Show the "OFFENSIVE CONDITIONS" sub-label under the wordmark. */
  showSub?: boolean;
  /** Wrap in a link to "/". Set false inside other links. */
  href?: string | null;
  className?: string;
}

export function Logo({
  variant = "full",
  size = 34,
  showSub = true,
  href = "/",
  className,
}: LogoProps) {
  const content =
    variant === "mark" ? (
      <LogoMark size={size} />
    ) : (
      <span className="flex items-center gap-[11px]">
        <LogoMark size={size} />
        <Wordmark showSub={showSub} />
      </span>
    );

  const wrapClass = cn("inline-flex items-center no-underline", className);

  if (href) {
    return (
      <Link href={href} className={wrapClass} aria-label={BRAND.fullName}>
        {content}
      </Link>
    );
  }
  return <span className={wrapClass}>{content}</span>;
}

/* -------------------------------------------------------------------------- */
/* Mark (shield)                                                              */
/* -------------------------------------------------------------------------- */
function LogoMark({ size }: { size: number }) {
  // Real image path provided → use it.
  if (BRAND.logoMark) {
    return (
      <Image
        src={BRAND.logoMark}
        alt={BRAND.name}
        width={size}
        height={Math.round(size * 1.16)}
        priority
        style={{ height: size, width: "auto" }}
      />
    );
  }
  // Inline SVG placeholder — the approved shield.
  return <ShieldSvg height={size} />;
}

/* -------------------------------------------------------------------------- */
/* Wordmark                                                                   */
/* -------------------------------------------------------------------------- */
function Wordmark({ showSub }: { showSub: boolean }) {
  // If a full logo image is set, prefer rendering it whole (mark+word) instead.
  // (Handled by callers choosing variant; here we render the text wordmark.)
  return (
    <span className="flex flex-col leading-none">
      <span className="font-display text-[23px] font-extrabold tracking-[0.5px]">
        <span className="bg-[linear-gradient(120deg,#A78BFA,#7C3AED)] bg-clip-text text-transparent">
          OFF
        </span>
        <span className="bg-[linear-gradient(120deg,#3B82F6,#1D4ED8)] bg-clip-text text-transparent">
          CON
        </span>
      </span>
      {showSub && (
        <span className="mt-[3px] text-[8.5px] font-semibold tracking-[4.5px] text-text-faint">
          OFFENSIVE CONDITIONS
        </span>
      )}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* The shield SVG (theme-agnostic — gradient fills look right on any bg)       */
/* -------------------------------------------------------------------------- */
function ShieldSvg({ height }: { height: number }) {
  return (
    <svg
      viewBox="0 0 100 116"
      style={{ height, width: "auto" }}
      className="shrink-0 drop-shadow-[0_4px_14px_rgba(109,40,217,0.45)]"
      role="img"
      aria-label={`${BRAND.name} shield`}
    >
      <defs>
        <linearGradient id="offcon-pg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8B5CF6" />
          <stop offset="1" stopColor="#6D28D9" />
        </linearGradient>
        <linearGradient id="offcon-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3B82F6" />
          <stop offset="1" stopColor="#1D4ED8" />
        </linearGradient>
        <clipPath id="offcon-sh">
          <path d="M50 6 L86 17 Q90 18 90 23 L90 60 Q90 89 54 108 Q50 110 46 108 Q10 89 10 60 L10 23 Q10 18 14 17 Z" />
        </clipPath>
      </defs>
      <g clipPath="url(#offcon-sh)">
        <rect x="0" y="0" width="50" height="116" fill="url(#offcon-pg)" />
        <rect x="50" y="0" width="50" height="116" fill="url(#offcon-bg)" />
      </g>
      <line x1="50" y1="9" x2="50" y2="106" stroke="#fff" strokeWidth="1" opacity="0.55" />
      <g stroke="#EDE4FF" strokeWidth="1.7" fill="#EDE4FF" strokeLinecap="round">
        <path d="M30 94 L30 54 L22 46" fill="none" />
        <path d="M30 65 L40 55" fill="none" />
        <circle cx="30" cy="94" r="2.3" fill="none" strokeWidth="1.7" />
        <circle cx="22" cy="44" r="2.6" />
        <circle cx="41" cy="54" r="2.6" />
      </g>
      <g stroke="#CFE0FF" strokeWidth="1.7" fill="#CFE0FF" strokeLinecap="round">
        <path d="M62 92 L62 62" fill="none" />
        <path d="M62 70 L72 57" fill="none" />
        <path d="M62 78 L55 67" fill="none" />
        <circle cx="62" cy="92" r="2.3" fill="none" strokeWidth="1.7" />
        <circle cx="73" cy="55" r="2.6" />
        <circle cx="54" cy="65" r="2.6" />
      </g>
    </svg>
  );
}
