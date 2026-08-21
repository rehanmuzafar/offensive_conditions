"use client";

import { Segmented } from "@/components/ui/segmented";
import { useState } from "react";
import { Trophy, History, Search } from "lucide-react";

import { Card, CardBody, Skeleton } from "@/components/ui/card";
import { Avatar } from "@/components/ui/identity";
import { Flag } from "@/components/ui/flag";
import { Podium } from "@/components/leaderboard/podium";
import { LeaderboardTable } from "@/components/leaderboard/leaderboard-table";
import { useLeaderboard, useHallOfFame, useSeasons } from "@/hooks/use-content";
import { formatNumber } from "@/lib/format";
import type { LeaderboardScope, LeaderboardWindow } from "@/types/leaderboard";

/* The season label is filled in from the live season — it was hard-coded to
   "Season 7" while the platform was on Season 1. */
const SCOPE_BASE: { value: LeaderboardScope; label: string }[] = [
  { value: "global", label: "Global" },
  { value: "season", label: "Season" },
  { value: "country", label: "By country" },
];
const WINDOWS: { value: LeaderboardWindow; label: string }[] = [
  { value: "all_time", label: "All time" },
  { value: "monthly", label: "This month" },
  { value: "weekly", label: "This week" },
];

export default function LeaderboardPage() {
  const [scope, setScope] = useState<LeaderboardScope>("global");
  const [window, setWindow] = useState<LeaderboardWindow>("all_time");
  const { data, isLoading } = useLeaderboard({ scope, window });

  const [q, setQ] = useState("");
  const { data: seasons } = useSeasons();
  const activeSeason = (seasons ?? []).find((s) => s.isActive) ?? seasons?.[0] ?? null;
  const SCOPES = SCOPE_BASE.map((s) =>
    s.value === "season" && activeSeason ? { ...s, label: activeSeason.name } : s,
  );

  const all = data?.items ?? [];
  /* Searching hides the podium: the top three are the top three of the board,
     not of the filter, and showing them above filtered rows would say the
     opposite. */
  const searching = q.trim().length > 0;
  const rows = searching
    ? all.filter((r) => r.username.toLowerCase().includes(q.trim().toLowerCase()))
    : all;
  /* The podium needs three to be a podium — it renders nothing with fewer, and
     the card around it used to stay, leaving an empty gradient panel above a
     table that had also lost everybody. `rest` sliced off the first three
     whether or not they were shown, so with two players the board displayed
     nobody at all. */
  const hasPodium = !searching && rows.length >= 3;
  const top3 = hasPodium ? rows.slice(0, 3) : [];
  const rest = hasPodium ? rows.slice(3) : rows;

  return (
    <>

      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2.5 font-display text-[28px] font-extrabold tracking-[-0.5px]">
              <Trophy className="h-7 w-7 text-accent" /> Leaderboard
            </h1>
            <p className="mt-1 text-[15px] text-text-dim">The best operators in the arena, ranked by points.</p>
          </div>
        </div>

        {/* controls */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented options={SCOPES} value={scope} onChange={setScope} />
          <Segmented options={WINDOWS} value={window} onChange={setWindow} size="sm" />
        </div>

        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search operators…"
            className="h-10 w-full border border-line bg-transparent pl-10 pr-4 text-[13px] text-text placeholder:text-text-ghost focus:border-text focus:outline-none"
          />
        </div>

        {isLoading ? (
          <Skeleton className="h-[400px] w-full rounded-2xl" />
        ) : all.length === 0 ? (
          /* An empty board rendered the podium anyway — a bare gradient panel
             above an empty table, which reads as a broken component rather than
             as "nobody has scored yet". */
          <Card>
            <CardBody className="py-16 text-center">
              <Trophy className="mx-auto h-7 w-7 text-text-ghost" />
              <p className="mt-3 font-display text-[15px] font-bold text-text">
                No ranked operators yet
              </p>
              <p className="mt-1 text-[13px] text-text-dim">
                The board fills as machines are owned and events are scored.
              </p>
            </CardBody>
          </Card>
        ) : searching && rows.length === 0 ? (
          <Card>
            <CardBody className="py-14 text-center text-[13px] text-text-dim">
              No operator matches “{q.trim()}”.
            </CardBody>
          </Card>
        ) : (
          <>
            {/* podium */}
            {hasPodium && (
            <Card className="overflow-hidden">
              <div className="relative">
                <div
                  className="absolute inset-0 opacity-[0.07]"
                  style={{ background: "linear-gradient(120deg,#7C3AED,#2563EB)" }}
                />
                <CardBody className="relative pt-8">
                  <Podium rows={top3} />
                </CardBody>
              </div>
            </Card>
            )}

            {/* full table */}
            <LeaderboardTable rows={rest} />
          </>
        )}

        {/* Hall of Fame */}
        <HallOfFame />
      </div>
    </>
  );
}

function HallOfFame() {
  const { data, isLoading } = useHallOfFame();
  return (
    <div className="pt-4">
      <div className="mb-4 flex items-center gap-2.5">
        <History className="h-6 w-6 text-accent" />
        <h2 className="font-display text-[22px] font-extrabold tracking-[-0.5px]">Hall of fame</h2>
      </div>
      <p className="mb-5 text-[14.5px] text-text-dim">Champions of past seasons — immortalised.</p>

      {isLoading || !data ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((entry) => (
            <Card key={entry.season.id} interactive>
              <CardBody className="flex items-center gap-4">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-brand-gradient text-[22px] shadow-glow">
                  🏆
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-semibold uppercase tracking-wide text-text-faint">
                    {entry.season.name}
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <Avatar username={entry.champion.username} src={entry.champion.avatarUrl} size="sm" />
                    <span className="truncate font-display text-[15px] font-bold">{entry.champion.username}</span>
                    {entry.champion.country && <Flag code={entry.champion.country} />}
                  </div>
                  <div className="mt-1 font-display text-[13px] font-bold text-accent">
                    {formatNumber(entry.champion.points)} pts
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
