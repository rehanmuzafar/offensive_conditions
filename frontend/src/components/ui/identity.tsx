import Image from "next/image";

import { cn } from "@/lib/cn";
import { initials } from "@/lib/format";
import type { Tier, MachineDifficulty, Os } from "@/types";

/* -------------------------------------------------------------------------- */
/* Avatar                                                                     */
/* -------------------------------------------------------------------------- */
const AV_SIZES = { sm: 30, md: 38, lg: 48, xl: 72 } as const;

export function Avatar({
  username,
  src,
  size = "md",
  className,
}: {
  username: string;
  src?: string | null;
  size?: keyof typeof AV_SIZES;
  className?: string;
}) {
  const px = AV_SIZES[size];
  if (src) {
    return (
      <Image
        src={src}
        alt={username}
        width={px}
        height={px}
        className={cn("border border-line object-cover", className)}
      />
    );
  }
  return (
    <span
      /* Initials on a solid accent chip — see `.chip-solid`. */
      className={cn(
        "chip-solid grid shrink-0 place-items-center font-display font-bold tracking-mega",
        className,
      )}
      style={{ width: px, height: px, fontSize: px * 0.36 }}
      aria-label={username}
    >
      {initials(username)}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Tier badge                                                                 */
/* -------------------------------------------------------------------------- */
const TIER_LABEL: Record<Tier, string> = {
  noob: "Noob",
  script_kiddie: "Script Kiddie",
  hacker: "Hacker",
  pro_hacker: "Pro Hacker",
  elite_hacker: "Elite Hacker",
  guru: "Guru",
  elite_operator: "Elite Operator",
  shadow_operator: "Shadow Operator",
  phantom: "Phantom",
  legend: "Legend",
};

export function TierBadge({ tier, className }: { tier: Tier; className?: string }) {
  // A brand-new account can arrive with no tier yet. Rendering the badge anyway
  // produced an empty bordered box next to the username — worse than nothing.
  const label = TIER_LABEL[tier];
  if (!label) return null;

  return (
    <span
      className={cn(
        "inline-flex items-center border border-accent/40 px-2 py-0.5 text-[9.5px] uppercase tracking-wide text-accent",
        className,
      )}
    >
      {label}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Difficulty badge                                                           */
/* -------------------------------------------------------------------------- */
/* Colour in the type and the border, never as a fill — the same rule the Badge
   primitive follows. A grid of machine cards otherwise becomes a grid of
   coloured pills. */
const DIFF: Record<MachineDifficulty, { label: string; cls: string }> = {
  easy: { label: "Easy", cls: "text-success border-success/45" },
  medium: { label: "Medium", cls: "text-warning border-warning/45" },
  hard: { label: "Hard", cls: "text-danger border-danger/45" },
  insane: { label: "Insane", cls: "text-accent border-accent/45" },
};

export function DifficultyBadge({ difficulty, className }: { difficulty: MachineDifficulty; className?: string }) {
  const d = DIFF[difficulty];
  return (
    <span className={cn("inline-flex items-center border px-2 py-0.5 text-[9.5px] uppercase tracking-wide", d.cls, className)}>
      {d.label}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* OS icon                                                                    */
/* -------------------------------------------------------------------------- */
export function OsIcon({ os, className }: { os: Os; className?: string }) {
  if (os === "windows") {
    return (
      <svg viewBox="0 0 24 24" className={cn("h-4 w-4", className)} fill="currentColor" aria-label="Windows">
        <path d="M3 5.5 10.5 4.4v7.1H3zM3 18.5l7.5 1.1v-7H3zM11.5 4.3 21 3v8.5h-9.5zM11.5 12.5H21V21l-9.5-1.3z" />
      </svg>
    );
  }
  // linux / other → penguin-ish glyph
  return (
    <svg viewBox="0 0 24 24" className={cn("h-4 w-4", className)} fill="currentColor" aria-label="Linux">
      <path d="M12 2c-2.2 0-3.5 1.9-3.5 4.3 0 1.4-.3 2.2-1.2 3.4C6 11.3 5 12.7 5 14.6c0 .9.3 1.5.3 2.3 0 .5-.6 1-.6 1.8 0 1.4 1.6 2.3 4 2.6.8.1 1.3.7 3.3.7s2.5-.6 3.3-.7c2.4-.3 4-1.2 4-2.6 0-.8-.6-1.3-.6-1.8 0-.8.3-1.4.3-2.3 0-1.9-1-3.3-2.3-4.9-.9-1.2-1.2-2-1.2-3.4C15.5 3.9 14.2 2 12 2zm-1.6 4.1c.5 0 .9.5.9 1.1s-.4 1.1-.9 1.1-.9-.5-.9-1.1.4-1.1.9-1.1zm3.2 0c.5 0 .9.5.9 1.1s-.4 1.1-.9 1.1-.9-.5-.9-1.1.4-1.1.9-1.1zM12 9.6c1 0 2 .6 2 1.1 0 .3-.5.5-1 .7v.2c0 .3-.5.5-1 .5s-1-.2-1-.5v-.2c-.5-.2-1-.4-1-.7 0-.5 1-1.1 2-1.1z" />
    </svg>
  );
}
