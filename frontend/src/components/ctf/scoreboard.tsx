import { TrendingUp, TrendingDown, Minus } from "lucide-react";

import { Flag } from "@/components/ui/flag";
import { formatNumber, formatRelative } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { ScoreboardRow } from "@/types/ctf";

/**
 * Scoreboard: a podium for the top three, then a ranked table.
 *
 * The measure is one thing — points — so each row carries an inline magnitude
 * bar in a single accent hue rather than a separate chart. Rank, name and value
 * are all text, so nothing is encoded by colour alone.
 */
export function Scoreboard({ rows }: { rows: ScoreboardRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="edge-iridescent glass px-4 py-10 text-center">
        <p className="text-[14px] text-text-dim">No solves yet — the board fills up as flags land.</p>
      </div>
    );
  }

  const podium = rows.slice(0, 3);
  const rest = rows.slice(3);
  const max = Math.max(...rows.map((r) => r.points), 1);

  return (
    <div className="space-y-4">
      {podium.length > 0 && <Podium rows={podium} />}

      {rest.length > 0 && (
        <div className="overflow-hidden glass">
          <div className="grid grid-cols-[44px_1fr_84px] items-center border-b border-line px-4 py-3 text-[11.5px] font-bold uppercase tracking-[1px] text-text-faint sm:grid-cols-[52px_1fr_150px_110px_84px]">
            <span>#</span>
            <span>Player</span>
            <span className="hidden sm:block">Points</span>
            <span className="hidden text-right sm:block">Last solve</span>
            <span className="text-right">Solves</span>
          </div>
          {rest.map((r) => (
            <div
              key={r.teamId}
              className="group relative grid grid-cols-[44px_1fr_84px] items-center border-b border-line px-4 py-3 transition-colors last:border-0 hover:bg-surface-hover sm:grid-cols-[52px_1fr_150px_110px_84px]"
            >
              <span className="font-display text-[15px] font-extrabold tabular-nums text-text-faint">
                {r.rank}
              </span>
              <div className="flex min-w-0 items-center gap-2.5">
                {r.country && <Flag code={r.country} />}
                <span className="truncate font-display text-[14.5px] font-semibold">{r.teamName}</span>
                <ChangeIcon change={r.change} />
              </div>
              <div className="hidden items-center gap-2 sm:flex">
                <PointsBar points={r.points} max={max} />
                <span className="w-12 shrink-0 text-right font-display text-[13.5px] font-bold tabular-nums text-text">
                  {formatNumber(r.points)}
                </span>
              </div>
              <span className="hidden text-right text-[12.5px] text-text-faint sm:block">
                {r.lastSolveAt ? formatRelative(r.lastSolveAt) : "—"}
              </span>
              <span className="text-right text-[13.5px] tabular-nums text-text-dim">{r.solveCount}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 1st centre and tallest, 2nd left, 3rd right — the conventional reading order. */
function Podium({ rows }: { rows: ScoreboardRow[] }) {
  const [first, second, third] = rows;
  const order = [second, first, third].filter(Boolean) as ScoreboardRow[];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-end">
      {order.map((r) => {
        const isFirst = r.rank === 1;
        return (
          <div
            key={r.teamId}
            className={cn(
              "relative overflow-hidden rounded-2xl border bg-surface px-4 pb-4 text-center",
              isFirst
                ? "border-accent/40 pt-6 shadow-glow sm:pt-8"
                : "border-line pt-5 sm:pt-6",
            )}
          >
            {isFirst && (
              <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-brand-gradient-soft" />
            )}
            <div
              className={cn(
                "relative mx-auto flex items-center justify-center rounded-full font-display font-extrabold tabular-nums",
                isFirst
                  ? "h-12 w-12 bg-brand-gradient text-[20px] text-text-on-brand"
                  : "h-10 w-10 border border-line-strong bg-bg-elevated text-[16px] text-text-dim",
              )}
            >
              {r.rank}
            </div>
            <div className="relative mt-3 flex items-center justify-center gap-2">
              {r.country && <Flag code={r.country} />}
              <span
                className={cn(
                  "truncate font-display font-bold",
                  isFirst ? "text-[17px] text-text" : "text-[15px] text-text",
                )}
              >
                {r.teamName}
              </span>
            </div>
            <p
              className={cn(
                "relative mt-1 font-display font-extrabold tabular-nums",
                isFirst ? "text-[28px] text-accent" : "text-[22px] text-text",
              )}
            >
              {formatNumber(r.points)}
              <span className="ml-1 text-[12px] font-semibold text-text-faint">pts</span>
            </p>
            <p className="relative mt-0.5 text-[12px] text-text-faint">
              {r.solveCount} {r.solveCount === 1 ? "solve" : "solves"}
              {r.lastSolveAt ? ` · ${formatRelative(r.lastSolveAt)}` : ""}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/** Inline magnitude bar: one hue, rounded data-end, anchored to a recessive track. */
function PointsBar({ points, max }: { points: number; max: number }) {
  const pct = Math.max(2, Math.round((points / max) * 100));
  return (
    <div
      className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-bg-elevated"
      title={`${formatNumber(points)} points`}
    >
      <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
    </div>
  );
}

function ChangeIcon({ change }: { change: number }) {
  if (change === 0) return <Minus className="h-3 w-3 shrink-0 text-text-faint" />;
  if (change > 0) return <TrendingUp className="h-3 w-3 shrink-0 text-success" />;
  return <TrendingDown className="h-3 w-3 shrink-0 text-danger" />;
}
