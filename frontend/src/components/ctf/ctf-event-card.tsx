import Link from "next/link";
import { Users, Flag, Trophy, Swords } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Countdown } from "@/components/ctf/countdown";
import { formatNumber, formatDate } from "@/lib/format";
import type { CtfEvent } from "@/types/ctf";

export function CtfEventCard({ event }: { event: CtfEvent }) {
  return (
    <Link href={`/ctf/${event.slug}`} className="block">
      <Card interactive className="group h-full overflow-hidden">
        <div
          className="relative h-40 overflow-hidden"
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
          <div
            className="absolute inset-0 opacity-25"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,.2) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.2) 1px,transparent 1px)",
              backgroundSize: "24px 24px",
            }}
          />
          <div className="absolute left-4 top-3.5 flex items-center gap-2">
            <StatePill state={event.state} status={event.status} />
            <span className="flex items-center gap-1 rounded-full bg-black/30 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur">
              {event.format === "jeopardy" ? <Flag className="h-3 w-3" /> : <Swords className="h-3 w-3" />}
              {event.format === "jeopardy" ? "Jeopardy" : "Attack-Defense"}
            </span>
          </div>
          {event.prizePool && (
            <div className="absolute right-4 top-3.5 flex items-center gap-1 rounded-full bg-black/30 px-2 py-0.5 text-[11px] font-bold text-white backdrop-blur">
              <Trophy className="h-3 w-3" /> {event.prizePool}
            </div>
          )}
          <div className="absolute bottom-3 left-4 right-4">
            <h3 className="font-display text-[20px] font-bold leading-tight text-white drop-shadow">{event.name}</h3>
          </div>
        </div>

        <div className="p-4">
          <p className="line-clamp-2 text-[14px] text-text-dim">{event.description}</p>

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
              <span className="ml-auto rounded-full bg-success/12 px-2 py-0.5 text-[11px] font-semibold text-success">
                Registered
              </span>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
}

function StatePill({ state, status }: { state: CtfEvent["state"]; status?: string }) {
  // Draft events are only ever returned to organisers, but they still arrived
  // badged "Upcoming" — indistinguishable from a published one.
  if (status === "draft") {
    return (
      <span className="rounded-full bg-black/40 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur">
        Draft · not published
      </span>
    );
  }
  return <StatePillInner state={state} />;
}

function StatePillInner({ state }: { state: CtfEvent["state"] }) {
  const map = {
    live: { label: "● Live", cls: "bg-success text-white" },
    upcoming: { label: "Upcoming", cls: "bg-black/30 text-white backdrop-blur" },
    ended: { label: "Ended", cls: "bg-black/30 text-white/80 backdrop-blur" },
  } as const;
  const s = map[state];
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.cls}`}>{s.label}</span>;
}
