"use client";

/**
 * The CTF arena — where a registered player actually plays.
 *
 * Split from `/ctf/[slug]`, which stays the public landing page with the banner,
 * the description and the register button. Once you are in, none of that is
 * useful screen space, so this route drops the app shell entirely and gives the
 * three columns HackTheBox uses: categories, scenarios, team.
 */

import { CtfAmbient } from "@/components/ctf/ctf-ambient";
import { LiveNotices } from "@/components/ctf/live-notices";
import { use, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ListChecks, BarChart3, Lock } from "lucide-react";

import { Countdown } from "@/components/ctf/countdown";
import { ScenarioBoard } from "@/components/ctf/scenario-board";
import { ScenarioDrawer } from "@/components/ctf/scenario-drawer";
import { EventScoreboard } from "@/components/ctf/event-scoreboard";
import { TeamRail } from "@/components/ctf/team-rail";
import { Skeleton } from "@/components/ui/card";
import { useChallengeProgress } from "@/hooks/use-progress";
import { useEventLive } from "@/hooks/use-event-live";
import {
  useCtfEvent,
  useCtfChallenges,
  useMyParticipation,
  useScoreboard,
} from "@/hooks/use-community";
import { cn } from "@/lib/cn";
import type { MyParticipation } from "@/lib/community-api";
import type { CtfChallenge, ScoreboardRow } from "@/types/ctf";

type Tab = "scenarios" | "scoreboard";

export default function ArenaPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { data: event, isLoading } = useCtfEvent(slug);
  const [tab, setTab] = useState<Tab>("scenarios");
  const [active, setActive] = useState<CtfChallenge | null>(null);

  useEventLive(event?.id, slug);
  const { data: challenges, error } = useCtfChallenges(slug);
  const { data: progressRows } = useChallengeProgress(event?.id);
  const { data: me } = useMyParticipation(event?.id);
  // Ranking is aggregated per team, so the participant row's own `rank` column
  // is stale — it once read #122 while the team stood far higher. Take the
  // standing from the same leaderboard the scoreboard renders.
  const { data: board } = useScoreboard(slug);
  const myStanding = useMemo(() => {
    const key = me?.team_id ?? null;
    if (!key) return null;
    return (board?.items ?? []).find((r) => r.teamId === key) ?? null;
  }, [board, me]);

  const progressByChallenge = useMemo(
    () => Object.fromEntries((progressRows ?? []).map((p) => [p.challenge_id, p])),
    [progressRows],
  );

  if (isLoading || !event) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  const solved = (challenges ?? []).filter((c) => c.solved).length;
  const total = challenges?.length ?? 0;
  // The ceiling is the sum of *base* points. Dynamic scoring decays the current
  // value as more teams solve, so summing that would put the ceiling below what
  // early teams already banked — the card read 300/100.
  const totalPoints = (challenges ?? []).reduce((sum, c) => sum + (c.basePoints ?? c.points), 0);

  return (
    <>
      <CtfAmbient />
      <LiveNotices />

      <div className="flex min-h-screen flex-col">
        {/* Arena bar: the event's own chrome, in place of the platform topbar. */}
        <header className="sticky top-0 z-30 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line bg-bg-elevated px-4 py-3 lg:px-6">
          <Link
            href={`/ctf/${slug}`}
            className="flex items-center gap-2 font-display text-[15px] font-bold text-text hover:text-accent"
            title="Back to the event page"
          >
            <ArrowLeft className="h-4 w-4" />
            {event.name}
          </Link>

          <nav className="flex items-center gap-1">
            <ArenaTab active={tab === "scenarios"} onClick={() => setTab("scenarios")} icon={<ListChecks className="h-4 w-4" />} label="Scenarios" />
            <ArenaTab active={tab === "scoreboard"} onClick={() => setTab("scoreboard")} icon={<BarChart3 className="h-4 w-4" />} label="Scoreboard" />
          </nav>

          {event.state === "live" && (
            <div className="ml-auto flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-1.5">
              <span className="text-[12.5px] text-text-dim">Ends in</span>
              <Countdown to={event.endsAt} />
            </div>
          )}
        </header>

        <div className="flex-1 px-4 py-5 lg:px-6">
          {error ? (
            <div className="mx-auto max-w-md rounded-2xl border border-line bg-surface px-4 py-12 text-center">
              <Lock className="mx-auto h-6 w-6 text-text-faint" />
              <p className="mt-3 font-display text-[16px] font-bold text-text">Scenarios locked</p>
              <p className="mt-1.5 text-[13.5px] text-text-dim">
                {error instanceof Error ? error.message : "Scenarios are not available."}
              </p>
              <Link
                href={`/ctf/${slug}`}
                className="mt-5 inline-block text-[13.5px] font-semibold text-accent hover:underline"
              >
                Back to the event page
              </Link>
            </div>
          ) : tab === "scenarios" ? (
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_340px]">
              <ScenarioBoard
                challenges={challenges ?? []}
                progressByChallenge={progressByChallenge}
                eventId={event.id}
                onOpen={setActive}
                headline={
                  <StatStrip solved={solved} total={total} me={me ?? null} standing={myStanding} />
                }
              />
              <TeamRail eventId={event.id} />
            </div>
          ) : (
            <ArenaScoreboard
              slug={slug}
              eventId={event.id}
              totalScenarios={total}
              totalPoints={totalPoints}
              myTeamId={me?.team_id ?? null}
            />
          )}
        </div>

        {active && (
          <ScenarioDrawer challenge={active} slug={slug} onClose={() => setActive(null)} />
        )}
      </div>
    </>
  );
}

/** The scoreboard component takes rows; this fetches them. */
function ArenaScoreboard({
  slug,
  eventId,
  totalScenarios,
  totalPoints,
  myTeamId,
}: {
  slug: string;
  eventId: string;
  totalScenarios: number;
  totalPoints: number;
  myTeamId: string | null;
}) {
  const { data: rows, isLoading } = useScoreboard(slug);
  if (isLoading) return <Skeleton className="h-64 w-full rounded-2xl" />;
  return (
    <EventScoreboard
      eventId={eventId}
      rows={rows?.items ?? []}
      eliminated={rows?.eliminated ?? []}
      myTeamId={myTeamId}
      totalScenarios={totalScenarios}
      totalPoints={totalPoints}
    />
  );
}

function ArenaTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-lg px-3 py-1.5 text-[14px] font-semibold transition-colors",
        active ? "bg-surface text-accent" : "text-text-dim hover:text-text",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function StatStrip({
  solved,
  total,
  me,
  standing,
}: {
  solved: number;
  total: number;
  me: MyParticipation | null;
  /** The team's row on the aggregated leaderboard, when they are on one. */
  standing: ScoreboardRow | null;
}) {
  // A team's numbers are the team's; a solo player's are their own.
  const rank = standing?.rank ?? me?.rank ?? null;
  const points = standing?.points ?? me?.points ?? 0;
  const flags = standing?.solveCount ?? me?.solve_count ?? 0;
  const cells = [
    { label: "Rank", value: rank ? `#${rank}` : "\u2014" },
    { label: "Points", value: points.toLocaleString() },
    { label: "Flags", value: `${flags}/${total}` },
    {
      label: "Scenarios",
      value: `${solved}/${total}`,
      progress: total ? solved / total : 0,
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
      {cells.map((c) => (
        <div key={c.label} className="rounded-xl border border-line bg-surface px-3.5 py-2.5">
          <p className="font-mono text-[17px] font-bold leading-none text-text">{c.value}</p>
          <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-faint">
            {c.label}
          </p>
          {c.progress !== undefined && (
            <span className="mt-1.5 block h-1 rounded-full bg-bg-elevated">
              <span
                className="block h-1 rounded-full bg-accent transition-all"
                style={{ width: `${c.progress * 100}%` }}
              />
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
