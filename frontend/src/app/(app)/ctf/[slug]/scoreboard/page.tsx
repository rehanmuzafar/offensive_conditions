"use client";

/**
 * Standings, outside the arena.
 *
 * The scoreboard only existed as a tab inside `/play`, which is gated on the
 * event being live and on having entered it. That made the standings
 * unreachable in the two moments people most want them: before the event, to
 * see who has turned up, and after it, to see how it finished. An event that
 * has ended cannot be entered at all, so its result was effectively sealed.
 *
 * Access is the organiser's setting, not the route's: `public` is open,
 * `participants` is entrants only, and `hidden` is nobody — for which this
 * answers the same way as a mistyped URL rather than confirming the event has
 * a scoreboard worth hiding.
 */

import { use } from "react";
import Link from "next/link";
import { ArrowLeft, BarChart3, Lock } from "lucide-react";

import { EventScoreboard } from "@/components/ctf/event-scoreboard";
import { Card, CardBody, Skeleton } from "@/components/ui/card";
import { useCtfEvent, useCtfChallenges, useScoreboard, useMyParticipation } from "@/hooks/use-community";

export default function EventScoreboardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);

  const { data: event, isLoading: loadingEvent } = useCtfEvent(slug);
  /* Keyed on the event id, which only exists once the event has loaded — the
     hook is disabled until then. */
  const { data: me } = useMyParticipation(event?.id);
  const { data: rows, isLoading: loadingRows } = useScoreboard(slug);
  /* Challenges are locked outside the arena on some events; the totals are only
     used for the "x of y" denominators, so a failure degrades rather than
     blocks. */
  const { data: challenges } = useCtfChallenges(slug);

  if (loadingEvent) return <Skeleton className="h-[60vh] w-full" />;
  if (!event) return null;

  const allowed =
    event.scoreboardVisibility === "public" ||
    (event.scoreboardVisibility === "participants" && event.isRegistered);

  if (!allowed) {
    return (
      <Card>
        <CardBody className="py-20 text-center">
          <Lock className="mx-auto h-7 w-7 text-text-ghost" />
          <p className="mt-3 font-display text-[15px] font-bold text-text">Standings are not public</p>
          <p className="mt-1 text-[13px] text-text-dim">
            {event.scoreboardVisibility === "participants"
              ? "Only entrants can see this scoreboard."
              : "The organisers have kept this scoreboard private."}
          </p>
          <Link href={`/ctf/${slug}`} className="mt-5 inline-block text-[13px] font-semibold text-accent hover:underline">
            Back to the event →
          </Link>
        </CardBody>
      </Card>
    );
  }

  const totalScenarios = challenges?.length ?? event.challengeCount ?? 0;
  const totalPoints = (challenges ?? []).reduce((n, c) => n + (c.basePoints ?? c.points), 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={`/ctf/${slug}`}
          className="flex items-center gap-2 text-[13.5px] text-text-dim transition-colors hover:text-text"
        >
          <ArrowLeft className="h-4 w-4" /> {event.name}
        </Link>
      </div>

      <h1 className="flex items-center gap-2.5 font-display text-[26px] font-extrabold tracking-[-0.5px]">
        <BarChart3 className="h-6 w-6 text-accent" /> Scoreboard
      </h1>

      {loadingRows ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <EventScoreboard
          eventId={event.id}
          rows={rows?.items ?? []}
          eliminated={rows?.eliminated ?? []}
          myTeamId={me?.team_id ?? null}
          totalScenarios={totalScenarios}
          totalPoints={totalPoints}
        />
      )}
    </div>
  );
}
