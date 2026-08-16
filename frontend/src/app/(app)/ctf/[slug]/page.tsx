"use client";

import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Users, Flag as FlagIcon, Trophy, Swords } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardBody, Skeleton } from "@/components/ui/card";
import { Countdown } from "@/components/ctf/countdown";
import { ChallengeSolver } from "@/components/ctf/challenge-solver";
import { EventRegister } from "@/components/ctf/event-register";
import { useChallengeProgress } from "@/hooks/use-progress";
import { useEventLive } from "@/hooks/use-event-live";
import { useCtfEvent } from "@/hooks/use-community";
import { formatNumber } from "@/lib/format";
import type { CtfChallenge } from "@/types/ctf";

export default function CtfEventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { data: event, isLoading } = useCtfEvent(slug);
  const [active, setActive] = useState<CtfChallenge | null>(null);
  // The solver shows the same row the grid badges use.
  // Push updates invalidate the same caches the polls fill.
  useEventLive(event?.id, slug);
  const { data: pageProgress } = useChallengeProgress(event?.id);
  const activeProgress = active
    ? (pageProgress ?? []).find((p) => p.challenge_id === active.id)
    : undefined;

  if (isLoading || !event) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-44 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link href="/ctf" className="inline-flex items-center gap-1.5 text-[14px] text-text-dim hover:text-text">
        <ArrowLeft className="h-4 w-4" /> All events
      </Link>

      {/* hero */}
      <Card className="overflow-hidden">
        {/* The uploaded cover renders here; the gradient is only the fallback.
            Taller than the old 8rem strip so an actual image is legible. */}
        <div
          className="relative h-48 sm:h-64"
          style={
            event.bannerImageUrl
              ? {
                  backgroundImage: `url(${event.bannerImageUrl})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }
              : { background: `linear-gradient(120deg, ${event.bannerColor}, #2563EB)` }
          }
        >
          {!event.bannerImageUrl && (
            <div
              className="absolute inset-0 opacity-25"
              style={{
                backgroundImage:
                  "linear-gradient(rgba(255,255,255,.2) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.2) 1px,transparent 1px)",
                backgroundSize: "26px 26px",
              }}
            />
          )}
        </div>
        <CardBody>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1 rounded-full bg-surface-hover px-2.5 py-0.5 text-[12px] font-semibold text-text-dim">
                  {event.format === "jeopardy" ? <FlagIcon className="h-3.5 w-3.5" /> : <Swords className="h-3.5 w-3.5" />}
                  {event.format === "jeopardy" ? "Jeopardy" : "Attack-Defense"}
                </span>
                {event.state === "live" && (
                  <span className="flex items-center gap-1.5 rounded-full bg-success/12 px-2.5 py-0.5 text-[12px] font-semibold text-success">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" /> Live
                  </span>
                )}
              </div>
              <h1 className="mt-2.5 font-display text-[28px] font-extrabold tracking-[-0.5px]">{event.name}</h1>
              <p className="mt-2 max-w-2xl text-[15px] text-text-dim">{event.description}</p>
            </div>

            <div className="text-right">
              {event.state === "upcoming" && (
                <>
                  <div className="mb-2 text-[12px] font-medium text-text-faint">Starts in</div>
                  <Countdown to={event.startsAt} />
                  <div className="mt-3">
                    <EventRegister
                      slug={slug}
                      registered={event.isRegistered}
                      teamPlay={event.teamPlay}
                      maxTeamSize={event.maxTeamSize}
                    />
                  </div>
                </>
              )}
              {event.state === "live" && (
                <>
                  <div className="mb-2 text-[12px] font-medium text-success">Ends in</div>
                  <Countdown to={event.endsAt} />
                  {/* The arena is a separate, chrome-free route; this is the
                      only way in, so it sits with the countdown. */}
                  {event.isRegistered ? (
                    <Link href={`/ctf/${slug}/play`} className="mt-3 block">
                      <Button fullWidth>
                        <Swords className="h-4 w-4" /> Enter arena
                      </Button>
                    </Link>
                  ) : (
                    <div className="mt-3">
                      <EventRegister
                        slug={slug}
                        registered={event.isRegistered}
                        teamPlay={event.teamPlay}
                        maxTeamSize={event.maxTeamSize}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* stat strip */}
          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-4 text-[13px] text-text-dim">
            <span className="flex items-center gap-1.5"><Users className="h-4 w-4 text-text-faint" /> {formatNumber(event.participantCount)} players</span>
            <span className="flex items-center gap-1.5"><FlagIcon className="h-4 w-4 text-text-faint" /> {event.challengeCount} challenges</span>
            <span className="flex items-center gap-1.5"><Users className="h-4 w-4 text-text-faint" /> {formatNumber(event.teamCount)} teams</span>
            {event.prizePool && <span className="flex items-center gap-1.5"><Trophy className="h-4 w-4 text-text-faint" /> {event.prizePool} prize pool</span>}
          </div>
        </CardBody>
      </Card>

      {/* Scenarios live in the arena, not here. This page stays the public
          shop window: anyone can read it, registered or not. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
        <section>
          <h2 className="font-display text-[18px] font-bold text-text">About the event</h2>
          <p className="mt-3 whitespace-pre-line text-[14.5px] leading-relaxed text-text-dim">
            {event.description || "The organiser hasn't written a description yet."}
          </p>
        </section>

        <aside className="space-y-5 rounded-2xl border border-line bg-surface p-5">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-wide text-text-faint">Going</p>
            <p className="mt-2 text-[14px] text-text">
              {formatNumber(event.participantCount)} players joined
            </p>
            {event.teamPlay && (
              <p className="mt-1 text-[14px] text-text">
                {formatNumber(event.teamCount)} teams joined
              </p>
            )}
          </div>

          <div className="border-t border-line pt-4">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-text-faint">
              Specifications
            </p>
            <dl className="mt-3 space-y-3 text-[14px]">
              <Spec label="Format" value={event.format === "jeopardy" ? "Jeopardy" : "Attack-Defense"} />
              <Spec label="Participation" value={event.teamPlay ? "Teams" : "Solo"} />
              {event.teamPlay && event.maxTeamSize && (
                <Spec label="Team size" value={`Max ${event.maxTeamSize} players per team`} />
              )}
              <Spec label="Scenarios" value={`${event.challengeCount}`} />
              {event.prizePool && <Spec label="Prize pool" value={event.prizePool} />}
              <Spec label="Starts" value={new Date(event.startsAt).toLocaleString()} />
              <Spec label="Ends" value={new Date(event.endsAt).toLocaleString()} />
            </dl>
          </div>
        </aside>
      </div>


      {active && (
        <ChallengeSolver
          eventSlug={slug}
          eventId={event?.id}
          challenge={active}
          progress={activeProgress}
          onClose={() => setActive(null)}
        />
      )}
    </div>
  );
}


function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[12.5px] text-text-faint">{label}</dt>
      <dd className="mt-0.5 text-text">{value}</dd>
    </div>
  );
}
