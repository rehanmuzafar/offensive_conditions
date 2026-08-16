"use client";

import { useState } from "react";
import { Trophy, History } from "lucide-react";

import { Card, CardBody, Skeleton } from "@/components/ui/card";
import { Avatar } from "@/components/ui/identity";
import { Flag } from "@/components/ui/flag";
import { Podium } from "@/components/leaderboard/podium";
import { LeaderboardTable } from "@/components/leaderboard/leaderboard-table";
import { useLeaderboard, useHallOfFame } from "@/hooks/use-content";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { LeaderboardScope, LeaderboardWindow } from "@/types/leaderboard";

const SCOPES: { value: LeaderboardScope; label: string }[] = [
  { value: "global", label: "Global" },
  { value: "season", label: "Season 7" },
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

  const rows = data?.items ?? [];
  const top3 = rows.slice(0, 3);
  const rest = rows.slice(3);

  return (
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
        <div className="flex rounded-xl border border-line-strong p-0.5">
          {SCOPES.map((s) => (
            <button
              key={s.value}
              onClick={() => setScope(s.value)}
              className={cn(
                "rounded-lg px-4 py-2 text-[13.5px] font-semibold transition-colors",
                scope === s.value ? "bg-brand-gradient text-white" : "text-text-dim hover:text-text",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex rounded-xl border border-line-strong p-0.5">
          {WINDOWS.map((w) => (
            <button
              key={w.value}
              onClick={() => setWindow(w.value)}
              className={cn(
                "rounded-lg px-3.5 py-2 text-[13px] font-medium transition-colors",
                window === w.value ? "bg-surface-hover text-text" : "text-text-faint hover:text-text",
              )}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-[400px] w-full rounded-2xl" />
      ) : (
        <>
          {/* podium */}
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

          {/* full table */}
          <LeaderboardTable rows={rest} />
        </>
      )}

      {/* Hall of Fame */}
      <HallOfFame />
    </div>
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
