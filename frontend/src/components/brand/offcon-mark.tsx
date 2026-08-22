"use client";

/**
 * The OFFCON mark — skull glyph plus wordmark.
 *
 * One component so the four surfaces cannot drift into four slightly different
 * logos, and so the label beside it ("LABS", "CTF", "BUG BOUNTY") is a prop
 * rather than something each shell hand-assembles.
 */

import { SkullGlyph } from "@/components/brand/skull-glyph";
import { cn } from "@/lib/cn";

export function OffconMark({
  label,
  size = 28,
  className,
  wordmark = true,
}: {
  /** Surface name shown after the wordmark, e.g. "CTF". */
  label?: string;
  size?: number;
  className?: string;
  /** Off in a narrow rail, where there is only room for the glyph. */
  wordmark?: boolean;
}) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <SkullGlyph
        style={{ width: size, height: size }}
        className="shrink-0 text-accent"
      />
      {wordmark && (
        <span className="flex items-baseline gap-1.5 whitespace-nowrap">
          <span className="font-display text-[17px] font-extrabold tracking-[-0.3px] text-text">
            OFFCON
          </span>
          {label && (
            <span className="font-display text-[13px] font-semibold uppercase tracking-wide text-text-faint">
              {label}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
