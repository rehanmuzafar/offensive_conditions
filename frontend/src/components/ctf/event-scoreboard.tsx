"use client";

/**
 * Event scoreboard: podium, standings, and your own team's card.
 *
 * The podium exists because ranks 1–3 are the only ones anyone reads at a
 * glance; the table below is for finding yourself. Your row is highlighted for
 * the same reason — in a list of hundreds, "where am I" is the real question.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { AlertTriangle, ChevronDown, Crown, Droplet, Pin, Search } from "lucide-react";

import { cn } from "@/lib/cn";
import { Flag } from "@/components/ui/flag";
import { Avatar } from "@/components/ui/identity";
import { ScoreboardInsights } from "@/components/ctf/scoreboard-insights";
import { TeamSolvesDialog } from "@/components/ctf/team-solves-dialog";
import type { ScoreboardRow } from "@/types/ctf";

export function EventScoreboard({
  rows,
  eliminated = [],
  myTeamId,
  totalScenarios,
  totalPoints,
  eventId,
}: {
  rows: ScoreboardRow[];
  /** Out for not turning in a writeup by the deadline. Shown, not hidden. */
  eliminated?: ScoreboardRow[];
  eventId: string;
  /** Sum of every scenario's points — the ceiling a team can reach. */
  totalPoints: number;
  /** Highlights the viewer's team and fills the sidebar card. */
  myTeamId?: string | null;
  totalScenarios: number;
}) {
  const [q, setQ] = useState("");
  /** The team whose solve breakdown is open, if any. */
  const [inspecting, setInspecting] = useState<ScoreboardRow | null>(null);
  /**
   * The published bonus whose reason is open, and where to draw it.
   *
   * Drawn through a portal rather than inside the cell: the table sits in an
   * `overflow-x-auto` wrapper, and a browser cannot scroll one axis while
   * leaving the other visible — so anything absolutely positioned in a cell is
   * clipped by it. The coordinates come from the button that was clicked.
   */
  const [openBonus, setOpenBonus] = useState<{
    team: string;
    delta: number;
    reason: string;
    x: number;
    top: number;
    bottom: number;
  } | null>(null);

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
      <div className="edge-iridescent glass px-4 py-16 text-center">
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
        {podium.length > 0 && (
          <Podium rows={podium} totalScenarios={totalScenarios} onInspect={setInspecting} />
        )}

        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search teams"
            className="edge-iridescent w-full rounded-xl glass py-2.5 pl-10 pr-3.5 text-[14px] text-text outline-none placeholder:text-text-faint focus:border-line-strong"
          />
        </div>

        <div className="overflow-x-auto glass">
          <table className="w-full min-w-[520px] text-left">
            <thead>
              <tr className="border-b border-line text-[11.5px] font-semibold uppercase tracking-wide text-text-faint">
                <th className="px-5 py-3 w-20">Rank</th>
                <th className="px-5 py-3">Team</th>
                <th className="px-5 py-3">Country</th>
                <th className="px-5 py-3 text-right">Bloods</th>
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
                    className={cn(
                      "group relative text-[13px] transition-colors hover:bg-surface-hover",
                      isMine && "bg-accent/10",
                    )}
                  >
                    <td className={cn("px-5 py-3.5 font-semibold", isMine ? "text-accent" : "text-text-dim")}>
                      <span className="flex items-center gap-1.5">
                        {r.rank}
                        {/* The board's promise is that more points finishes
                            higher. A pin breaks it for this row, so the row
                            says so rather than passing a hand-set position off
                            as an earned one. */}
                        {r.pinned && (
                          <Pin
                            className="h-3 w-3 text-accent"
                            aria-label="Position set by the organisers"
                          >
                            <title>{r.pinnedReason || "Position set by the organisers"}</title>
                          </Pin>
                        )}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="flex items-center gap-2.5">
                        <Avatar username={r.teamName} size="sm" />
                        {/* The name goes to the team; the flag count opens what
                            they solved. The route resolves a UUID as well as a
                            handle, which is what a scoreboard row carries. */}
                        <Link
                          href={`/teams/${r.teamId}`}
                          className={cn(
                            "relative truncate transition-colors hover:text-text",
                            isMine ? "text-accent" : "text-text",
                          )}
                        >
                          {r.teamName}
                          <span className="iridescent-rule absolute -bottom-0.5 left-0 h-px w-0 transition-[width] duration-300 group-hover:w-full" />
                        </Link>
                        {isMine && <span className="text-[10px] uppercase tracking-wide text-text-faint">you</span>}
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
                    {/* First bloods sit before points on purpose: they are the
                        thing a scoreboard cannot recover from, so they belong
                        next to the name rather than tucked at the end. */}
                    <td className="px-5 py-3.5 text-right tabular-nums">
                      {r.firstBloods ? (
                        <span className="inline-flex items-center gap-1 text-danger">
                          <Droplet className="h-3 w-3" /> {r.firstBloods}
                        </span>
                      ) : (
                        <span className="text-text-ghost">—</span>
                      )}
                    </td>
                    <td className={cn("px-5 py-3.5 text-right tabular-nums", isMine ? "text-accent" : "text-text-dim")}>
                      {r.points.toLocaleString()}
                      {/* Published bonuses only. A quiet adjustment is already
                          inside the number above and says nothing here — that
                          is the choice the organiser made when applying it.

                          Clickable, not just a tooltip: the reason is the whole
                          point of publishing one, and a title attribute is
                          invisible on touch and to anyone not hovering. */}
                      {(r.bonuses ?? []).map((b, i) => (
                        <button
                          key={i}
                          onClick={(e) => {
                            const box = e.currentTarget.getBoundingClientRect();
                            setOpenBonus({
                              team: r.teamName,
                              delta: b.delta,
                              reason: b.reason,
                              x: box.right,
                              // Both edges, so the card can decide which way to
                              // open once it knows how tall it is.
                              top: box.top,
                              bottom: box.bottom,
                            });
                          }}
                          className={cn(
                            "ml-1.5 whitespace-nowrap text-[11px] underline decoration-dotted underline-offset-2",
                            b.delta > 0 ? "text-success" : "text-danger",
                          )}
                        >
                          {b.delta > 0 ? "+" : ""}
                          {b.delta}
                        </button>
                      ))}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <button
                        onClick={() => setInspecting(r)}
                        title={`See what ${r.teamName} solved`}
                        className={cn(
                          "relative tabular-nums transition-colors hover:text-text",
                          isMine ? "text-accent" : "text-text-dim",
                        )}
                      >
                        {r.solveCount}
                        {totalScenarios > 0 && <span className="text-text-faint">/{totalScenarios}</span>}
                        <span className="iridescent-rule absolute -bottom-0.5 left-0 h-px w-0 transition-[width] duration-300 group-hover:w-full" />
                      </button>
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

      {/* Below the board, folded away. These teams scored — they are out for
          not turning in a writeup, not for playing badly — so the result stays
          readable without them, and readable *with* them when someone asks
          where a team went. */}
      {eliminated.length > 0 && <EliminatedSection rows={eliminated} />}

      {openBonus && <BonusNote note={openBonus} onClose={() => setOpenBonus(null)} />}

      {inspecting && (
        <TeamSolvesDialog
          eventId={eventId}
          teamId={inspecting.teamId}
          teamName={inspecting.teamName}
          onClose={() => setInspecting(null)}
        />
      )}

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

/**
 * The reason behind a published bonus.
 *
 * A portal, because the table lives inside a horizontally scrolling wrapper and
 * an absolutely positioned child of a cell gets clipped by it. Clicking rather
 * than hovering, because a `title` attribute shows nothing on a touch screen —
 * and the reason is the entire point of publishing the bonus.
 */
function BonusNote({
  note,
  onClose,
}: {
  note: { team: string; delta: number; reason: string; x: number; top: number; bottom: number };
  onClose: () => void;
}) {
  /**
   * Open upwards when there is no room below.
   *
   * The last rows of a scoreboard sit at the bottom of the viewport, and a card
   * that always drops downwards lands off-screen — with nothing to scroll to,
   * because it is fixed. Measuring after the first paint is the only way to
   * know how tall it is.
   */
  const card = useRef<HTMLDivElement>(null);
  /** null until measured — the card stays hidden for that one frame. */
  const [flip, setFlip] = useState<boolean | null>(null);

  useEffect(() => {
    const node = card.current;
    if (!node) return;
    const height = node.getBoundingClientRect().height;
    setFlip(note.bottom + height + 12 > window.innerHeight);
  }, [note]);
  useEffect(() => {
    function dismiss() {
      onClose();
    }
    // Scrolling moves the anchor out from under the card, so it closes with it.
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    document.addEventListener("mousedown", dismiss);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
      document.removeEventListener("mousedown", dismiss);
    };
  }, [onClose]);

  return createPortal(
    <div
      role="tooltip"
      ref={card}
      style={{
        position: "fixed",
        // Kept on screen when the row sits near the right edge.
        left: Math.min(note.x, window.innerWidth - 260),
        ...(flip === true
          ? { bottom: window.innerHeight - note.top + 6 }
          : { top: note.bottom + 6 }),
        // Hidden for the one frame it takes to measure, so it never flashes in
        // the wrong place.
        visibility: flip === null ? "hidden" : "visible",
      }}
      className="glass-strong z-[90] w-[240px] border border-line px-3.5 py-2.5 text-[12px] leading-relaxed text-text-dim shadow-card-lg"
    >
      <span className="block font-display text-[12.5px] font-bold text-text">{note.team}</span>
      <span className={cn("font-mono", note.delta > 0 ? "text-success" : "text-danger")}>
        {note.delta > 0 ? "+" : ""}
        {note.delta} pts
      </span>{" "}
      — {note.reason || "no reason given"}
    </div>,
    document.body,
  );
}

function EliminatedSection({ rows }: { rows: ScoreboardRow[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="edge-iridescent glass">
      <button
        onClick={() => setOpen((v) => !v)}
        className="group flex w-full items-center justify-between px-5 py-3.5 transition-colors hover:bg-surface-hover"
      >
        <span className="flex items-center gap-2 text-[13px] text-text-dim">
          <AlertTriangle className="h-3.5 w-3.5 text-warning" />
          Eliminated — no writeup by the deadline
        </span>
        <span className="flex items-center gap-2.5 text-[10.5px] uppercase tracking-wide text-text-faint">
          {rows.length} team{rows.length === 1 ? "" : "s"}
          <ChevronDown
            className={cn("h-3.5 w-3.5 transition-transform duration-300", open && "rotate-180")}
          />
        </span>
      </button>

      {open && (
        <ul className="border-t border-line">
          {rows.map((r) => (
            <li
              key={r.teamId || r.teamName}
              className="grid grid-cols-[auto_1fr_auto] items-center gap-4 border-b border-line px-5 py-3 text-[12.5px] last:border-0"
            >
              <span className="tabular-nums text-text-faint">#{r.rank}</span>
              <span className="flex min-w-0 items-center gap-2.5">
                <Avatar username={r.teamName} size="sm" />
                <span className="truncate text-text-dim line-through decoration-danger/60">
                  {r.teamName}
                </span>
              </span>
              <span className="tabular-nums text-text-faint">{r.points.toLocaleString()} pts</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Second, first, third — first is centre and taller, the way a podium reads. */
function Podium({
  rows,
  totalScenarios,
  onInspect,
}: {
  rows: ScoreboardRow[];
  totalScenarios: number;
  onInspect: (row: ScoreboardRow) => void;
}) {
  const [first, second, third] = rows;
  const order = [
    { row: second, place: 2 },
    { row: first, place: 1 },
    { row: third, place: 3 },
  ].filter((s): s is { row: ScoreboardRow; place: number } => Boolean(s.row));

  return (
    <div className="flex flex-wrap items-end justify-center gap-4">
      {order.map(({ row, place }) => (
        <PodiumCard
          key={row.teamId}
          row={row}
          place={place}
          totalScenarios={totalScenarios}
          onInspect={onInspect}
        />
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
  onInspect,
}: {
  onInspect: (row: ScoreboardRow) => void;
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
      {/* Two targets, matching the table below: the name goes to the team, the
          flag count opens what they solved. It was one button over the whole
          card, so every click — including one aimed at the name — opened the
          solves dialog. They also cannot nest: a link inside a button is not
          valid, which is why the card itself is no longer a control. */}
      <div
        className={cn(
          "edge-iridescent group transition-transform duration-300 ease-out hover:-translate-y-1",
          "w-[190px] glass px-4 pb-5 pt-7 text-center sm:w-[220px]",
          first && "sm:w-[240px] sm:pb-8 sm:pt-9",
        )}
      >
        <Link href={`/teams/${row.teamId}`} title={`${row.teamName}'s team page`}>
          <Avatar username={row.teamName} size={first ? "xl" : "lg"} className="mx-auto" />
          <p
            className={cn(
              "relative mt-3 inline-block max-w-full truncate font-display font-bold text-text transition-colors hover:text-accent",
              first ? "text-[17px]" : "text-[15px]",
            )}
            title={row.teamName}
          >
            {row.teamName}
            <span className="iridescent-rule absolute -bottom-0.5 left-0 h-px w-0 transition-[width] duration-300 group-hover:w-full" />
          </p>
        </Link>
        <p className="mt-1.5 flex items-center justify-center gap-2 text-[13.5px] text-text-dim">
          {row.countryCode && <Flag code={row.countryCode} />}
          {row.points.toLocaleString()} pts
        </p>
        <button
          type="button"
          onClick={() => onInspect(row)}
          title={`See what ${row.teamName} solved`}
          className="mt-0.5 text-[12.5px] text-text-faint transition-colors hover:text-accent hover:underline"
        >
          {row.solveCount}
          {totalScenarios > 0 && `/${totalScenarios}`} flags
        </button>
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
    // top-[104px] clears the arena bar, which is ~91px tall with the countdown
    // in it. At 84px the first card was tucked under the clock.
    <aside className="space-y-3 xl:sticky xl:top-[104px] xl:self-start">
      <ProgressCard value={row.solveCount} total={totalScenarios} label="Flags" />
      {/* Points out of the event's ceiling — a share of what is actually on
          offer, which "scenarios" only approximated when every one was worth
          the same. */}
      <ProgressCard value={row.points} total={totalPoints} label="Points" />

      {/* Two clipped layers: the outer is the iridescent edge, the inner is the
          panel. See `.pennant` for why a border cannot be drawn on one. */}
      <div className="pennant">
        <div className="pennant-inner glass px-5 pb-14 pt-7 text-center">
          <Avatar username={row.teamName} size="xl" className="mx-auto" />
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
      </div>
    </aside>
  );
}

function ProgressCard({ value, total, label }: { value: number; total: number; label: string }) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  return (
    <div className="edge-iridescent glass px-5 py-5 text-center transition-transform duration-300 ease-out hover:-translate-y-0.5">
      <p className="font-mono text-[22px] font-bold leading-none text-text">
        {total ? `${value.toLocaleString()}/${total.toLocaleString()}` : value.toLocaleString()}
      </p>
      <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-text-faint">
        {label}
      </p>
      <span className="mt-3.5 block h-[3px] bg-bg-elevated">
        <span
          className="block h-[3px] bg-success transition-all"
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


function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return "th";
  return ["th", "st", "nd", "rd"][n % 10] ?? "th";
}
