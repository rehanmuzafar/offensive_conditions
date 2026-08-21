"use client";

import clsx from "clsx";
import { useQuery } from "@tanstack/react-query";

import { scoringApi } from "@/lib/scoring-api";
import { Reveal, RevealGroup, RevealItem, RevealWords } from "@/components/landing/ui/Reveal";
import { Eyebrow, GhostWord } from "@/components/landing/ui/Bits";

/** How many rows the ladder shows. Six fits the section without scrolling. */
const ROWS = 6;

/**
 * The season ladder.
 *
 * Laid out as a table of monospace figures with a bar behind each row scaled
 * to that operator's points — the ranking is legible at a glance from the bar
 * alone, and the numbers are there for anyone who wants them. The top three
 * are not given medals or colour; the bar length already says it, and colour
 * here would be the fourth accent on a page that is meant to hold one.
 */
export default function Ladder() {
  /* Real operators, not a seeded list.
     The landing page is the one place the platform makes a claim about itself,
     and six invented handles undercut every number beside them. Both queries
     are public — the ladder and the season are what a visitor sees before
     signing in — so an anonymous visitor gets the same board a member does. */
  const { data: board } = useQuery({
    queryKey: ["landing-ladder"],
    queryFn: () => scoringApi.leaderboard({ scope: "global", limit: ROWS }),
    staleTime: 60_000,
  });
  const { data: seasons } = useQuery({
    queryKey: ["landing-seasons"],
    queryFn: () => scoringApi.seasons(),
    staleTime: 300_000,
  });

  const rows = board?.items ?? [];
  const season = (seasons ?? []).find((s) => s.isActive) ?? seasons?.[0] ?? null;
  // Reduce rather than index [0]: the bars stay correct whatever the order, and
  // it type-checks without asserting the array is non-empty.
  const maxPoints = rows.reduce((max, op) => Math.max(max, op.points), 1);

  return (
    <section id="ladder" className="relative px-6 py-28 lg:px-10">
      <div className="mx-auto max-w-[1440px]">
        <div className="relative">
          <GhostWord className="absolute -top-14 left-0 hidden text-[15vw] lg:block">
            Ladder
          </GhostWord>

          <Reveal>
            <Eyebrow index="III" label="Hall of fame" />
          </Reveal>

          <div className="mt-7 flex flex-wrap items-end justify-between gap-8">
            <h2 className="font-display text-[clamp(30px,5vw,72px)] font-extrabold uppercase leading-[0.94] tracking-mega">
              <RevealWords text="The global" className="block" />
              <RevealWords text="leaderboard" className="block" />
            </h2>

            <Reveal delay={0.15}>
              <p className="max-w-[360px] text-[13.5px] leading-[1.75] text-text-dim">
                Top operators this season, ranked by points across machines,
                challenges and CTFs. Resets every 90 days — the ladder is a
                snapshot, not a trophy case.
              </p>
            </Reveal>
          </div>
        </div>

        <div className="mt-16 overflow-x-auto">
          <div className="min-w-[620px]">
            {/* Column header, styled as a spec-sheet key rather than a table head. */}
            <div className="grid grid-cols-[54px_1fr_74px_84px_92px_88px] gap-4 border-b border-white/[0.07] pb-3 text-[9.5px] uppercase tracking-widest text-text-ghost">
              <span>Rank</span>
              <span>Operator</span>
              <span className="text-right">Firsts</span>
              <span className="text-right">Bugs</span>
              <span className="text-right">Streak</span>
              <span className="text-right">Points</span>
            </div>

            <RevealGroup stagger={0.05}>
              {rows.map((op) => (
                <RevealItem key={op.userId}>
                  <div
                    data-cursor="hover"
                    className="group relative grid grid-cols-[54px_1fr_74px_84px_92px_88px] items-center gap-4 border-b border-white/[0.07] py-5"
                  >
                    {/* Points bar, behind the text. */}
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-y-0 left-0 -z-10 bg-white/[0.045] transition-colors duration-500 group-hover:bg-white/[0.09]"
                      style={{ width: `${(op.points / maxPoints) * 100}%` }}
                    />

                    <span
                      className={clsx(
                        "font-display text-[19px] font-extrabold tabular-nums",
                        op.rank <= 3 ? "text-text" : "text-text-ghost",
                      )}
                    >
                      {String(op.rank).padStart(2, "0")}
                    </span>

                    <span className="flex items-center gap-3">
                      <span className="text-[13.5px] text-text transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-1.5">
                        {op.username}
                      </span>
                      <span className="border border-white/10 px-1.5 py-0.5 text-[9px] tracking-wide text-text-ghost">
                        {op.country ?? "—"}
                      </span>
                    </span>

                    <span className="text-right text-[12px] tabular-nums text-text-faint">
                      {op.firstBloods}
                    </span>
                    {/* Accepted reports only, low severity and above. */}
                    <span className="text-right text-[12px] tabular-nums text-text-faint">
                      {op.acceptedBugs}
                    </span>
                    <span className="text-right text-[12px] tabular-nums text-text-faint">
                      {op.streakDays}d
                    </span>
                    <span className="text-right text-[13px] tabular-nums text-text-dim">
                      {op.points.toLocaleString("en-US")}
                    </span>
                  </div>
                </RevealItem>
              ))}
            </RevealGroup>
          </div>
        </div>

        <Reveal delay={0.1}>
          <div className="mt-8 flex items-center gap-3 text-[10.5px] uppercase tracking-wide text-text-ghost">
            <span className="iridescent-rule h-px w-10 opacity-70" />
            {season ? season.name : "Season —"} ·{" "}
            {rows.length > 0
              ? `${rows.length} ranked operator${rows.length === 1 ? "" : "s"} shown`
              : "no ranked operators yet"}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
