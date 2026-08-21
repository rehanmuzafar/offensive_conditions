"use client";

import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BarChart3, FileText, PauseCircle, Users, Flag as FlagIcon, Trophy, UserCog, Swords } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardBody, Skeleton } from "@/components/ui/card";
import { Countdown } from "@/components/ctf/countdown";
import { ChallengeSolver } from "@/components/ctf/challenge-solver";
import { LiveNotices } from "@/components/ctf/live-notices";
import { EventRegister } from "@/components/ctf/event-register";
import { TeamRosterDialog } from "@/components/ctf/team-roster-dialog";
import { WriteupSubmitDialog } from "@/components/ctf/writeup-submit-dialog";
import { useChallengeProgress } from "@/hooks/use-progress";
import { useEventLive } from "@/hooks/use-event-live";
import { useCtfEvent, useMyParticipation } from "@/hooks/use-community";
import { useQuery } from "@tanstack/react-query";
import { teamsApi } from "@/lib/teams-api";
import { useAuthStore } from "@/stores/auth-store";
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
  const [rosterOpen, setRosterOpen] = useState(false);
  const [writeupOpen, setWriteupOpen] = useState(false);
  /* Which team the viewer entered under, and whether they captain it. Both are
     needed before offering roster control: the server refuses a non-captain, so
     showing the button to one would be a door that opens onto an error. */
  const me = useAuthStore((s) => s.user);
  const { data: myPart } = useMyParticipation(event?.id);
  const myTeamId = myPart?.team_id ?? null;
  const { data: myTeamMembers } = useQuery({
    queryKey: ["team-members", myTeamId],
    enabled: Boolean(myTeamId),
    queryFn: () => teamsApi.members(myTeamId as string),
  });
  const isCaptain = Boolean(
    me &&
      (myTeamMembers ?? []).some(
        (m) => m.user_id === me.id && ["owner", "captain"].includes(m.role.toLowerCase()),
      ),
  );
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

  /* `hidden` keeps the standings out of the product entirely — they stay
     reachable from the admin panel and nowhere else. `participants` is
     entrants only; the route enforces the same rule, so this is only about not
     offering a door that would refuse to open. */
  const scoreboardOpen =
    event.scoreboardVisibility === "public" ||
    (event.scoreboardVisibility === "participants" && event.isRegistered);

  return (
    <>
      <LiveNotices />

      <div className="space-y-6">
        <Link href="/ctf" className="inline-flex items-center gap-1.5 text-[14px] text-text-dim hover:text-text">
          <ArrowLeft className="h-4 w-4" /> All events
        </Link>

        {/* hero */}
        <Card className="overflow-hidden">
          {/*
            16:9, and the image is *contained* rather than cropped.

            A fixed-height strip with `background-size: cover` meant every cover
            lost its top and bottom — authors compose an image and the page threw
            most of it away. The frame is now the ratio covers are actually
            designed at, the image sits inside it whole, and the leftover space
            is a blown-up blurred copy of the same image rather than black bars.
            That reads as depth instead of as a mistake, and it works whatever
            aspect ratio someone uploads.
          */}
          <div
            className={`relative aspect-video w-full overflow-hidden border-b border-line ${
              event.bannerImageUrl ? "" : "bg-grid"
            }`}
            style={
              event.bannerImageUrl ? undefined : { borderLeft: `1px solid ${event.bannerColor}` }
            }
          >
            {event.bannerImageUrl && (
              <>
                <div
                  aria-hidden
                  className="absolute inset-0 scale-110 blur-2xl"
                  style={{
                    backgroundImage: `url(${event.bannerImageUrl})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }}
                />
                <div
                  className="absolute inset-0"
                  style={{
                    backgroundImage: `url(${event.bannerImageUrl})`,
                    backgroundSize: "contain",
                    backgroundPosition: "center",
                    backgroundRepeat: "no-repeat",
                  }}
                />
              </>
            )}
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
                  {/* A paused event is still live in the lifecycle, but saying
                      "Live" above a greyed-out arena is the page arguing with
                      itself. */}
                  {event.state === "live" && !event.isPaused && (
                    <span className="flex items-center gap-1.5 rounded-full bg-success/12 px-2.5 py-0.5 text-[12px] font-semibold text-success">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" /> Live
                    </span>
                  )}
                  {event.state === "live" && event.isPaused && (
                    <span className="flex items-center gap-1.5 rounded-full bg-warning/12 px-2.5 py-0.5 text-[12px] font-semibold text-warning">
                      <PauseCircle className="h-3 w-3" /> Paused
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
                      event.isPaused ? (
                        /* Paused is not ended: the standings stay readable, but
                           nothing is accepting flags, so the way in is shut
                           rather than hidden. */
                        <div className="mt-3">
                          <Button fullWidth disabled>
                            <PauseCircle className="h-4 w-4" /> Event paused
                          </Button>
                          {event.pauseReason && (
                            <p className="mt-1.5 text-[12px] text-warning">{event.pauseReason}</p>
                          )}
                        </div>
                      ) : (
                        <Link href={`/ctf/${slug}/play`} className="mt-3 block">
                          <Button fullWidth>
                            <Swords className="h-4 w-4" /> Enter arena
                          </Button>
                        </Link>
                      )
                    ) : (
                      <div className="mt-3">
                        <EventRegister
                          slug={slug}
                          registered={event.isRegistered}
                          teamPlay={event.teamPlay}
                        />
                      </div>
                    )}
                  </>
                )}

                {/* Standings, in every state the event can be in. They used to
                    live only inside the arena, which meant they vanished the
                    moment the event ended and the result could no longer be
                    read at all. */}
                {scoreboardOpen && (
                  <Link href={`/ctf/${slug}/scoreboard`} className="mt-2.5 block">
                    <Button variant="ghost" fullWidth>
                      <BarChart3 className="h-4 w-4" /> Scoreboard
                    </Button>
                  </Link>
                )}

                {/* Roster control, for the captain of the team they entered
                    under. Anyone else would be refused by ctf-svc. */}
                {event.isRegistered && myTeamId && isCaptain && (
                  <div className="mt-2.5 space-y-2.5">
                    <Button variant="ghost" fullWidth onClick={() => setRosterOpen(true)}>
                      <UserCog className="h-4 w-4" /> Team management
                    </Button>
                    {/* The writeup is the captain's to send: it is what the
                        deadline and the prize hang on. */}
                    <Button variant="ghost" fullWidth onClick={() => setWriteupOpen(true)}>
                      <FileText className="h-4 w-4" /> Submit writeup
                    </Button>
                  </div>
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
            <h2 className="font-display text-[18px] font-bold tracking-mega text-text">About the event</h2>
            {/* The long-form copy if the organiser wrote any, otherwise the
                one-line description — never an empty panel. */}
            <div className="edge-iridescent glass mt-4 p-5">
              <p className="prose-reading whitespace-pre-line text-text-dim">
                {event.about?.trim() ||
                  event.description ||
                  "The organiser hasn't written anything about this event yet."}
              </p>
            </div>
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

        {rosterOpen && myTeamId && (
          <TeamRosterDialog slug={slug} teamId={myTeamId} onClose={() => setRosterOpen(false)} />
        )}

        {writeupOpen && (
          <WriteupSubmitDialog slug={slug} onClose={() => setWriteupOpen(false)} />
        )}
      </div>
    </>
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
