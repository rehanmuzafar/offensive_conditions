import Link from "next/link";
import { Crown } from "lucide-react";

import { Avatar, TierBadge } from "@/components/ui/identity";
import { Flag } from "@/components/ui/flag";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { LeaderRow } from "@/types/leaderboard";

/** 1st is centre and taller, the way a podium reads. */
const PLACE_STYLE: Record<number, string> = {
  1: "bg-warning text-black",
  2: "bg-text-faint text-black",
  3: "bg-[#CD7F32] text-black",
};

/**
 * The top three, in the same shape the CTF arena uses.
 *
 * That podium was rebuilt around glass panels with a spectral edge and a lift
 * on hover; this one was still stacked blocks with emoji medals, so the two
 * leaderboards in the product did not look like the same product. The layout
 * rule is shared too: second, first, third — first centred and larger.
 */
export function Podium({ rows }: { rows: LeaderRow[] }) {
  if (rows.length < 3) return null;
  const [first, second, third] = rows;

  return (
    <div className="flex flex-wrap items-end justify-center gap-4">
      <PodiumCard row={second!} place={2} />
      <PodiumCard row={first!} place={1} />
      <PodiumCard row={third!} place={3} />
    </div>
  );
}

function PodiumCard({ row, place }: { row: LeaderRow; place: 1 | 2 | 3 }) {
  const first = place === 1;
  return (
    <div
      className={cn(
        "relative flex flex-col items-center",
        first ? "order-2" : place === 2 ? "order-1" : "order-3",
      )}
    >
      <span
        className={cn(
          "z-10 -mb-3 grid h-8 w-8 place-items-center rounded-md text-[13px] font-bold",
          PLACE_STYLE[place],
        )}
      >
        {first ? <Crown className="h-4 w-4" /> : place}
      </span>

      <div
        className={cn(
          "edge-iridescent group transition-transform duration-300 ease-out hover:-translate-y-1",
          "w-[190px] glass px-4 pb-5 pt-7 text-center sm:w-[220px]",
          first && "sm:w-[240px] sm:pb-8 sm:pt-9",
        )}
      >
        {/* The name is the link, as it is on the arena board — the card itself
            is not a control, so a link can live inside it. */}
        <Link href={`/u/${row.username}`} title={`${row.username}'s profile`}>
          <Avatar username={row.username} src={row.avatarUrl} size={first ? "xl" : "lg"} className="mx-auto" />
          <p
            className={cn(
              "relative mt-3 inline-block max-w-full truncate font-display font-bold text-text transition-colors hover:text-accent",
              first ? "text-[17px]" : "text-[15px]",
            )}
            title={row.username}
          >
            {row.username}
            <span className="iridescent-rule absolute -bottom-0.5 left-0 h-px w-0 transition-[width] duration-300 group-hover:w-full" />
          </p>
        </Link>

        <p className="mt-1.5 flex items-center justify-center gap-2 text-[13.5px] text-text-dim">
          {row.country && <Flag code={row.country} />}
          {formatNumber(row.points)} pts
        </p>

        <TierBadge tier={row.tier} className="mt-2" />

        <p className="mt-2 text-[12.5px] text-text-faint">
          {formatNumber(row.ownedMachines)} owns · {formatNumber(row.acceptedBugs)} bugs
        </p>
      </div>
    </div>
  );
}
