import Link from "next/link";
import { Users, Flag, Trophy, Swords } from "lucide-react";

import { Tilt } from "@/components/ui/motion";
import { Card } from "@/components/ui/card";
import { Countdown } from "@/components/ctf/countdown";
import { formatNumber, formatDate } from "@/lib/format";
import type { CtfEvent } from "@/types/ctf";

/**
 * An event card.
 *
 * The banner keeps its two branches for a reason. When an event has real
 * artwork, white type on a dark scrim over the image is the correct treatment
 * and it stays. It is only the *fallback* that changed: events without artwork
 * used to invent a gradient from `bannerColor`, which meant a listing page was
 * a patchwork of unrelated hues. The fallback is now the ruled plate used
 * everywhere else, with `bannerColor` reduced to an identifying hairline.
 */
export function CtfEventCard({ event }: { event: CtfEvent }) {
  const hasArtwork = Boolean(event.bannerImageUrl);

  /* Same tilt as the machine grid and the dashboard tiles — one motion
     vocabulary across every card in the product. */
  return (
    <Tilt className="h-full">
      <Link href={`/ctf/${event.slug}`} className="block">
        <Card interactive className="group h-full overflow-hidden">
          <div
            className={`relative h-40 overflow-hidden border-b border-line ${
              hasArtwork ? "" : "bg-grid"
            }`}
            style={
              hasArtwork
                ? {
                    backgroundImage: `url(${event.bannerImageUrl})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }
                : undefined
            }
          >
            {/* Artwork gets a scrim so the chips and title stay readable over any
                image; the ruled fallback needs none. */}
            {hasArtwork && <div className="absolute inset-0 bg-black/45" />}
            {!hasArtwork && (
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 w-px opacity-70"
                style={{ background: event.bannerColor }}
              />
            )}
            <div className="absolute left-4 top-3.5 flex items-center gap-2">
              <StatePill state={event.state} status={event.status} paused={event.isPaused} />
              <span className="flex items-center gap-1.5 border border-white/25 bg-black/40 px-2 py-0.5 text-[9.5px] uppercase tracking-wide text-white backdrop-blur">
                {event.format === "jeopardy" ? <Flag className="h-2.5 w-2.5" /> : <Swords className="h-2.5 w-2.5" />}
                {event.format === "jeopardy" ? "Jeopardy" : "Attack-Defense"}
              </span>
            </div>
            {event.prizePool && (
              <div className="absolute right-4 top-3.5 flex items-center gap-1.5 border border-white/25 bg-black/40 px-2 py-0.5 text-[9.5px] uppercase tracking-wide text-white backdrop-blur">
                <Trophy className="h-2.5 w-2.5" /> {event.prizePool}
              </div>
            )}
            <div className="absolute bottom-3 left-4 right-4">
              <h3 className="font-display text-[21px] font-bold leading-tight tracking-mega text-white drop-shadow">
                {event.name}
              </h3>
            </div>
          </div>

          <div className="p-4">
            <p className="line-clamp-2 text-[12.5px] leading-[1.7] text-text-dim">{event.description}</p>

            {/* timing */}
            <div className="mt-4">
              {event.state === "upcoming" && (
                <div>
                  <div className="mb-1.5 text-[12px] font-medium text-text-faint">Starts in</div>
                  <Countdown to={event.startsAt} />
                </div>
              )}
              {event.state === "live" && (
                <div>
                  <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-success">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" /> Ends in
                  </div>
                  <Countdown to={event.endsAt} />
                </div>
              )}
              {event.state === "ended" && (
                <div className="text-[13px] text-text-faint">Ended {formatDate(event.endsAt)}</div>
              )}
            </div>

            {/* stats */}
            <div className="mt-4 flex items-center gap-4 border-t border-line pt-3 text-[12.5px] text-text-faint">
              <span className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5" /> {formatNumber(event.participantCount)}</span>
              <span className="flex items-center gap-1.5"><Flag className="h-3.5 w-3.5" /> {event.challengeCount} challenges</span>
              {event.isRegistered && (
                <span className="ml-auto bg-success/12 px-2 py-0.5 text-[11px] font-semibold text-success">
                  Registered
                </span>
              )}
            </div>
          </div>
        </Card>
      </Link>
    </Tilt>
  );
}

function StatePill({
  state,
  status,
  paused,
}: {
  state: CtfEvent["state"];
  status?: string;
  /** Paused is not a lifecycle state — the event is still live, it is just not
   *  taking flags. It has to say so, though: a card reading "Live" beside an
   *  arena nobody can enter is the UI contradicting itself. */
  paused?: boolean;
}) {
  // Draft events are only ever returned to organisers, but they still arrived
  // badged "Upcoming" — indistinguishable from a published one.
  if (status === "draft") {
    return (
      <span className="border border-white/25 bg-black/40 px-2 py-0.5 text-[9.5px] uppercase tracking-wide text-white backdrop-blur">
        Draft · not published
      </span>
    );
  }
  return <StatePillInner state={paused && state === "live" ? "paused" : state} />;
}

function StatePillInner({ state }: { state: CtfEvent["state"] | "paused" }) {
  const map = {
    live: { label: "● Live", cls: "border border-success/50 bg-black/50 text-success backdrop-blur" },
    paused: { label: "❙❙ Paused", cls: "border border-warning/50 bg-black/50 text-warning backdrop-blur" },
    upcoming: { label: "Upcoming", cls: "border border-white/25 bg-black/40 text-white backdrop-blur" },
    ended: { label: "Ended", cls: "bg-black/30 text-white/80 backdrop-blur" },
  } as const;
  const s = map[state];
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.cls}`}>{s.label}</span>;
}
