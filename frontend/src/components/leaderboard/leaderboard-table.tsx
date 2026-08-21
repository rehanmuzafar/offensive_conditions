
import { Avatar, TierBadge } from "@/components/ui/identity";
import { Flag } from "@/components/ui/flag";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { LeaderRow } from "@/types/leaderboard";

const MEDALS = ["🥇", "🥈", "🥉"];

export function LeaderboardTable({ rows }: { rows: LeaderRow[] }) {
  return (
    <div className="overflow-hidden glass">
      {/* header */}
      <div className="grid grid-cols-[60px_1fr_90px_90px_110px] items-center border-b border-line px-5 py-3.5 text-[12px] font-bold uppercase tracking-[1px] text-text-faint sm:grid-cols-[60px_1fr_150px_100px_100px_110px]">
        <span>Rank</span>
        <span>Hacker</span>
        <span className="hidden sm:block">Country</span>
        <span className="text-right">Owns</span>
        {/* Only reports that were accepted at a real severity — see the
            leaderboard query for what that excludes and why. */}
        <span className="text-right">Bugs</span>
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
    <div className="group relative grid grid-cols-[60px_1fr_90px_90px_110px] items-center border-b border-line px-5 py-3.5 transition-colors last:border-0 hover:bg-surface-hover sm:grid-cols-[60px_1fr_150px_100px_100px_110px]">
      {/* rank */}
      <span className={cn("font-display font-extrabold", top ? "text-[18px] text-gradient" : "text-[16px] text-text-faint")}>
        {top ? <span className="mr-1">{MEDALS[row.rank - 1]}</span> : null}
        {row.rank}
      </span>

      {/* hacker */}
      <div className="flex min-w-0 items-center gap-3">
        <Avatar username={row.username} src={row.avatarUrl} size="sm" />
        <div className="min-w-0">
          {/* No rank-change arrow: nothing computes it. `change` is mapped as a
              constant 0, so the indicator only ever drew a flat dash beside
              every name — a control that looked like information and was not. */}
          <span className="block truncate font-display text-[14.5px] font-semibold">
            {row.username}
          </span>
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

      {/* accepted bugs */}
      <span
        className="text-right text-[13.5px] text-text-dim"
        title="Accepted reports, low severity and above"
      >
        {formatNumber(row.acceptedBugs)}
      </span>

      {/* points */}
      <span className={cn("text-right font-display text-[15px] font-bold", top ? "text-accent" : "text-text")}>
        {formatNumber(row.points)}
      </span>
    </div>
  );
}

