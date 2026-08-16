"use client";

/**
 * Event scoreboard: podium, standings, and your own team's card.
 *
 * The podium exists because ranks 1–3 are the only ones anyone reads at a
 * glance; the table below is for finding yourself. Your row is highlighted for
 * the same reason — in a list of hundreds, "where am I" is the real question.
 */

import { useMemo, useState } from "react";
import { Crown, Droplet, Search } from "lucide-react";

import { cn } from "@/lib/cn";
import { Flag } from "@/components/ui/flag";
import { ScoreboardInsights } from "@/components/ctf/scoreboard-insights";
import type { ScoreboardRow } from "@/types/ctf";

export function EventScoreboard({
  rows,
  myTeamId,
  totalScenarios,
  totalPoints,
  eventId,
}: {
  rows: ScoreboardRow[];
  eventId: string;
  /** Sum of every scenario's points — the ceiling a team can reach. */
  totalPoints: number;
  /** Highlights the viewer's team and fills the sidebar card. */
  myTeamId?: string | null;
  totalScenarios: number;
}) {
  const [q, setQ] = useState("");

  const podium = rows.slice(0, 3);
  const mine = useMemo(
    () => (myTeamId ? rows.find((r) => r.teamId === myTeamId) : undefined),
    [rows, myTeamId],
  );
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? rows.filter((r) => r.teamName.toLowerCase().includes(needle)) : rows;
  }, [rows, q]);

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-line bg-surface px-4 py-16 text-center">
        <p className="text-[15px] font-semibold text-text">No standings yet</p>
        <p className="mt-1.5 text-[13.5px] text-text-dim">
          The scoreboard fills in as soon as the first flag lands.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[1fr_300px]">
      <div className="min-w-0 space-y-6">
        <ScoreboardInsights eventId={eventId} />
        {podium.length > 0 && <Podium rows={podium} totalScenarios={totalScenarios} />}

        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search teams"
            className="w-full rounded-xl border border-line bg-surface py-2.5 pl-10 pr-3.5 text-[14px] text-text outline-none placeholder:text-text-faint focus:border-line-strong"
          />
        </div>

        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[520px] text-left">
            <thead>
              <tr className="border-b border-line text-[11.5px] font-semibold uppercase tracking-wide text-text-faint">
                <th className="px-5 py-3 w-20">Rank</th>
                <th className="px-5 py-3">Team</th>
                <th className="px-5 py-3">Country</th>
                <th className="px-5 py-3 text-right">Points</th>
                <th className="px-5 py-3 text-right">Flags</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.map((r) => {
                const isMine = Boolean(myTeamId) && r.teamId === myTeamId;
                return (
                  <tr
                    key={r.teamId || `${r.rank}-${r.teamName}`}
                    className={cn("text-[14px]", isMine && "bg-accent/10")}
                  >
                    <td className={cn("px-5 py-3.5 font-semibold", isMine ? "text-accent" : "text-text-dim")}>
                      {r.rank}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="flex items-center gap-2.5">
                        <Avatar name={r.teamName} />
                        <span className={cn("font-semibold", isMine ? "text-accent" : "text-text")}>
                          {r.teamName}
                        </span>
                        {isMine && <span className="text-[11px] text-text-faint">you</span>}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-[13px] text-text-dim">
                      {r.countryCode ? (
                        <span className="flex items-center gap-1.5">
                          <Flag code={r.countryCode} /> {r.countryCode}
                        </span>
                      ) : (
                        <span className="text-text-faint">—</span>
                      )}
                    </td>
                    <td className={cn("px-5 py-3.5 text-right", isMine ? "text-accent" : "text-text-dim")}>
                      {r.points.toLocaleString()}
                    </td>
                    <td className={cn("px-5 py-3.5 text-right", isMine ? "text-accent" : "text-text-dim")}>
                      {r.solveCount}
                      {totalScenarios > 0 && (
                        <span className="text-text-faint">/{totalScenarios}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {shown.length === 0 && (
            <p className="px-5 py-10 text-center text-[13.5px] text-text-dim">
              No team matches that search.
            </p>
          )}
        </div>
      </div>

      {mine && (
        <MyTeamCard
          row={mine}
          rows={rows}
          totalScenarios={totalScenarios}
          totalPoints={totalPoints}
        />
      )}
    </div>
  );
}

/** Second, first, third — first is centre and taller, the way a podium reads. */
function Podium({ rows, totalScenarios }: { rows: ScoreboardRow[]; totalScenarios: number }) {
  const [first, second, third] = rows;
  const order = [
    { row: second, place: 2 },
    { row: first, place: 1 },
    { row: third, place: 3 },
  ].filter((s): s is { row: ScoreboardRow; place: number } => Boolean(s.row));

  return (
    <div className="flex flex-wrap items-end justify-center gap-4">
      {order.map(({ row, place }) => (
        <PodiumCard key={row.teamId} row={row} place={place} totalScenarios={totalScenarios} />
      ))}
    </div>
  );
}

const PLACE_STYLE: Record<number, string> = {
  1: "bg-warning text-black",
  2: "bg-text-faint text-black",
  3: "bg-[#CD7F32] text-black",
};

function PodiumCard({
  row,
  place,
  totalScenarios,
}: {
  row: ScoreboardRow;
  place: number;
  totalScenarios: number;
}) {
  const first = place === 1;
  return (
    <div className={cn("relative flex flex-col items-center", first ? "order-2" : place === 2 ? "order-1" : "order-3")}>
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
          "w-[190px] rounded-2xl border border-line bg-surface px-4 pb-5 pt-7 text-center sm:w-[220px]",
          first && "sm:w-[240px] sm:pb-8 sm:pt-9",
        )}
      >
        <Avatar name={row.teamName} size={first ? 64 : 52} className="mx-auto" />
        <p
          className={cn(
            "mt-3 truncate font-display font-bold text-text",
            first ? "text-[17px]" : "text-[15px]",
          )}
          title={row.teamName}
        >
          {row.teamName}
        </p>
        <p className="mt-1.5 flex items-center justify-center gap-2 text-[13.5px] text-text-dim">
          {row.countryCode && <Flag code={row.countryCode} />}
          {row.points.toLocaleString()} pts
        </p>
        <p className="mt-0.5 text-[12.5px] text-text-faint">
          {row.solveCount}
          {totalScenarios > 0 && `/${totalScenarios}`} flags
        </p>
      </div>
    </div>
  );
}

/**
 * Your team's standing, pinned beside the table.
 *
 * Sticky on purpose: the whole reason to scroll a scoreboard is to compare
 * yourself to the rows around you, and a card that scrolls away takes the
 * reference point with it.
 *
 * The gap to the next rank is ours, not borrowed — a standing is only
 * actionable if you know what it would take to move.
 */
function MyTeamCard({
  row,
  rows,
  totalScenarios,
  totalPoints,
}: {
  row: ScoreboardRow;
  rows: ScoreboardRow[];
  totalScenarios: number;
  totalPoints: number;
}) {
  const pct = totalScenarios > 0 ? Math.min(100, (row.solveCount / totalScenarios) * 100) : 0;
  const ahead = rows.find((r) => r.rank === row.rank - 1);
  const gap = ahead ? ahead.points - row.points : 0;

  return (
    // Sticky on purpose: the reason to scroll a scoreboard is to compare
    // yourself to the rows around you, and a card that scrolls away takes the
    // reference point with it.
    <aside className="space-y-3 xl:sticky xl:top-[84px] xl:self-start">
      <ProgressCard value={row.solveCount} total={totalScenarios} label="Flags" />
      {/* Points out of the event's ceiling — a share of what is actually on
          offer, which "scenarios" only approximated when every one was worth
          the same. */}
      <ProgressCard value={row.points} total={totalPoints} label="Points" />

      {/* The pennant is cut with a clip-path rather than drawn, so it keeps its
          shape at any height. */}
      <div
        className="border border-line bg-surface px-5 pb-14 pt-7 text-center"
        style={{
          clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 34px), 50% 100%, 0 calc(100% - 34px))",
        }}
      >
        <Avatar name={row.teamName} size={62} className="mx-auto" />
        <p className="mt-3.5 truncate font-display text-[16px] font-bold text-text" title={row.teamName}>
          {row.teamName}
        </p>
        {row.countryCode && (
          <p className="mt-1.5 flex items-center justify-center gap-1.5 text-[12.5px] text-text-dim">
            <Flag code={row.countryCode} /> {row.countryCode}
          </p>
        )}

        <div className="mt-7 space-y-6">
          <BigStat value={`${row.rank}`} suffix={ordinal(row.rank)} label="Team rank" />
          <BigStat value={row.points.toLocaleString()} suffix="pts" label="Team points" />
          <BigStat
            value={totalScenarios ? `${row.solveCount}/${totalScenarios}` : `${row.solveCount}`}
            label="Flags"
            underline
          />
          <div>
            <p className="flex items-center justify-center gap-1.5 text-[17px] font-bold text-danger">
              <Droplet className="h-4 w-4" /> {row.firstBloods ?? 0}
            </p>
            <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-text-faint">
              First bloods
            </p>
          </div>
        </div>

        {/* Ours, not borrowed: a standing is only actionable if you know what it
            would take to move. */}
        {ahead && (
          <p className="mt-7 text-[12.5px] text-text-dim">
            <span className="font-semibold text-text">
              {gap > 0 ? `${gap.toLocaleString()} pts` : "A tie-break"}
            </span>{" "}
            from #{ahead.rank}
          </p>
        )}
        <p className="mt-1 text-[11px] uppercase tracking-wide text-text-faint">
          of {rows.length} teams · {Math.round(pct)}% complete
        </p>
      </div>
    </aside>
  );
}

function ProgressCard({ value, total, label }: { value: number; total: number; label: string }) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  return (
    <div className="rounded-2xl border border-line bg-surface px-5 py-5 text-center">
      <p className="font-mono text-[22px] font-bold leading-none text-text">
        {total ? `${value.toLocaleString()}/${total.toLocaleString()}` : value.toLocaleString()}
      </p>
      <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-text-faint">
        {label}
      </p>
      <span className="mt-3.5 block h-[3px] rounded-full bg-bg-elevated">
        <span
          className="block h-[3px] rounded-full bg-success transition-all"
          style={{ width: `${pct}%` }}
        />
      </span>
    </div>
  );
}

function BigStat({
  value,
  suffix,
  label,
  underline,
}: {
  value: string;
  suffix?: string;
  label: string;
  underline?: boolean;
}) {
  return (
    <div>
      <p className={cn("font-mono text-[19px] font-bold text-text", underline && "underline decoration-line-strong underline-offset-4")}>
        {value}
        {suffix && <span className="text-[12.5px] font-medium text-text-faint">{suffix}</span>}
      </p>
      <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-text-faint">
        {label}
      </p>
    </div>
  );
}

function Avatar({ name, size = 32, className }: { name: string; size?: number; className?: string }) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-brand-gradient font-bold text-text-on-brand",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.32) }}
    >
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return "th";
  return ["th", "st", "nd", "rd"][n % 10] ?? "th";
}
