import { TrendingUp, TrendingDown, Minus } from "lucide-react";

import { Avatar, TierBadge } from "@/components/ui/identity";
import { Flag } from "@/components/ui/flag";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { LeaderRow } from "@/types/leaderboard";

const MEDALS = ["🥇", "🥈", "🥉"];

export function LeaderboardTable({ rows }: { rows: LeaderRow[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      {/* header */}
      <div className="grid grid-cols-[60px_1fr_120px_110px] items-center border-b border-line px-5 py-3.5 text-[12px] font-bold uppercase tracking-[1px] text-text-faint sm:grid-cols-[60px_1fr_160px_120px_110px]">
        <span>Rank</span>
        <span>Hacker</span>
        <span className="hidden sm:block">Country</span>
        <span className="text-right">Owns</span>
        <span className="text-right">Points</span>
      </div>

      {rows.map((r) => (
        <LeaderboardRow key={r.userId} row={r} />
      ))}
    </div>
  );
}

function LeaderboardRow({ row }: { row: LeaderRow }) {
  const top = row.rank <= 3;
  return (
    <div className="grid grid-cols-[60px_1fr_120px_110px] items-center border-b border-line px-5 py-3.5 transition-colors last:border-0 hover:bg-surface-hover sm:grid-cols-[60px_1fr_160px_120px_110px]">
      {/* rank */}
      <span className={cn("font-display font-extrabold", top ? "text-[18px] text-gradient" : "text-[16px] text-text-faint")}>
        {top ? <span className="mr-1">{MEDALS[row.rank - 1]}</span> : null}
        {row.rank}
      </span>

      {/* hacker */}
      <div className="flex min-w-0 items-center gap-3">
        <Avatar username={row.username} src={row.avatarUrl} size="sm" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-display text-[14.5px] font-semibold">{row.username}</span>
            <ChangeIndicator change={row.change} />
          </div>
          <TierBadge tier={row.tier} className="mt-0.5" />
        </div>
      </div>

      {/* country */}
      <div className="hidden items-center gap-2 text-[13.5px] text-text-dim sm:flex">
        {row.country ? (
          <>
            <Flag code={row.country} />
            <span className="uppercase">{row.country}</span>
          </>
        ) : (
          <span className="text-text-faint">—</span>
        )}
      </div>

      {/* owns */}
      <span className="text-right text-[13.5px] text-text-dim">{formatNumber(row.ownedMachines)}</span>

      {/* points */}
      <span className={cn("text-right font-display text-[15px] font-bold", top ? "text-accent" : "text-text")}>
        {formatNumber(row.points)}
      </span>
    </div>
  );
}

function ChangeIndicator({ change }: { change: number }) {
  if (change === 0) {
    return <Minus className="h-3.5 w-3.5 text-text-faint" />;
  }
  if (change > 0) {
    return (
      <span className="flex items-center gap-0.5 text-[11.5px] font-semibold text-success">
        <TrendingUp className="h-3.5 w-3.5" />
        {change}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-0.5 text-[11.5px] font-semibold text-danger">
      <TrendingDown className="h-3.5 w-3.5" />
      {Math.abs(change)}
    </span>
  );
}
