import { Avatar, TierBadge } from "@/components/ui/identity";
import { Flag } from "@/components/ui/flag";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { LeaderRow } from "@/types/leaderboard";

/**
 * Top-3 podium. Renders 2nd / 1st / 3rd with the champion raised in the center.
 */
export function Podium({ rows }: { rows: LeaderRow[] }) {
  if (rows.length < 3) return null;
  const [first, second, third] = rows;

  return (
    <div className="grid grid-cols-3 items-end gap-3 sm:gap-5">
      <PodiumCard row={second!} place={2} />
      <PodiumCard row={first!} place={1} />
      <PodiumCard row={third!} place={3} />
    </div>
  );
}

function PodiumCard({ row, place }: { row: LeaderRow; place: 1 | 2 | 3 }) {
  const medal = place === 1 ? "🥇" : place === 2 ? "🥈" : "🥉";
  const height = place === 1 ? "h-[150px]" : place === 2 ? "h-[120px]" : "h-[100px]";
  const avatarSize = place === 1 ? "lg" : "md";

  return (
    <div className="flex flex-col items-center">
      <div className={cn("relative mb-3", place === 1 && "scale-110")}>
        <Avatar username={row.username} src={row.avatarUrl} size={avatarSize} className={place === 1 ? "ring-2 ring-accent ring-offset-2 ring-offset-bg" : ""} />
        <span className="absolute -right-1 -top-1 text-[18px]">{medal}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className={cn("font-display font-bold", place === 1 ? "text-[16px]" : "text-[14px]")}>{row.username}</span>
        {row.country && <Flag code={row.country} className="!h-3.5 !w-[19px]" />}
      </div>
      <TierBadge tier={row.tier} className="mt-1" />
      <span className="mt-1 font-display text-[15px] font-extrabold text-gradient">{formatNumber(row.points)}</span>

      <div
        className={cn(
          "mt-3 w-full rounded-t-2xl border border-b-0 border-line",
          height,
          place === 1 ? "bg-brand-gradient-soft" : "bg-surface",
        )}
      >
        <div className="grid h-full place-items-center">
          <span className={cn("font-display font-extrabold", place === 1 ? "text-[40px] text-gradient" : "text-[30px] text-text-faint")}>
            {place}
          </span>
        </div>
      </div>
    </div>
  );
}
