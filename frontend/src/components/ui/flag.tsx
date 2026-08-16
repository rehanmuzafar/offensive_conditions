/**
 * <Flag /> — renders a crisp SVG country flag via the flag-icons library
 * (loaded once in the marketing/app shell). Pass an ISO 3166-1 alpha-2 code.
 *
 * This is what powers flags on the leaderboard + hall of fame.
 */

import { cn } from "@/lib/cn";
import { flagCode } from "@/lib/format";
import { isSupportedCountry } from "@/lib/countries";

interface FlagProps {
  /** ISO alpha-2 country code, e.g. "pk", "de", "us". */
  code: string;
  className?: string;
}

export function Flag({ code, className }: FlagProps) {
  // Only render flags for recognised, selectable countries — an unsupported
  // code (e.g. "IL") shows nothing rather than a flag.
  if (!isSupportedCountry(code)) return null;
  const c = flagCode(code);
  return (
    <span
      className={cn(
        "fi inline-block shrink-0 rounded-[3px] shadow-[0_1px_4px_rgba(0,0,0,0.4)]",
        `fi-${c}`,
        className,
      )}
      style={{ width: 22, height: 16 }}
      role="img"
      aria-label={`${c.toUpperCase()} flag`}
    />
  );
}
