"use client";

import { useState, useMemo } from "react";
import { Flag } from "lucide-react";

import { CtfEventCard } from "@/components/ctf/ctf-event-card";
import { Skeleton } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { useCtfEvents, useJoinedEventIds } from "@/hooks/use-community";
import type { CtfState } from "@/types/ctf";

/**
 * "Joined" replaces what used to be "All".
 *
 * All was the default and showed everything, which is what the page shows
 * anyway once you clear a filter — it answered a question nobody had. What a
 * returning player actually wants first is the events they are in, so that is
 * the tab, and it opens on it.
 */
type Tab = CtfState | "joined";

const TABS: { value: Tab; label: string }[] = [
  { value: "joined", label: "Joined" },
  { value: "live", label: "Live now" },
  { value: "upcoming", label: "Upcoming" },
  { value: "ended", label: "Past" },
];

export default function CtfPage() {
  const [tab, setTab] = useState<Tab>("joined");
  const { data, isLoading } = useCtfEvents();
  const { data: joinedIds } = useJoinedEventIds();

  const events = useMemo(() => {
    const all = data?.items ?? [];
    if (tab !== "joined") return all.filter((e) => e.state === tab);
    // A Set because this runs against the whole list on every render of a page
    // that also holds a live socket.
    const joined = new Set(joinedIds ?? []);
    return all.filter((e) => joined.has(e.id));
  }, [data, tab, joinedIds]);

  /* A paused event is not "live right now" in the sense a player reads
     this: nothing is accepting flags. */
  const liveCount = (data?.items ?? []).filter((e) => e.state === "live" && !e.isPaused).length;

  return (
    <div className="space-y-6">

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2.5 font-display text-[28px] font-extrabold tracking-[-0.5px]">
            <Flag className="h-7 w-7 text-accent" /> CTF Arena
          </h1>
          <p className="mt-1 text-[15px] text-text-dim">
            Compete in jeopardy and attack-defense events. {liveCount > 0 && (
              <span className="font-semibold text-success">{liveCount} live right now.</span>
            )}
          </p>
        </div>
      </div>

      {/* tabs */}
        <Segmented options={TABS} value={tab} onChange={setTab} />

      {isLoading ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[300px] w-full rounded-2xl" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line py-20 text-center">
          <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-surface-hover text-text-faint">
            <Flag className="h-7 w-7" />
          </div>
          <h3 className="font-display text-[18px] font-semibold">
            {tab === "joined" ? "You haven't joined an event yet" : `No ${tab} events right now`}
          </h3>
          <p className="mt-1 text-[14px] text-text-dim">
            {tab === "joined"
              ? "Open Live now or Upcoming and register — events you enter show up here."
              : "Check back soon — new events drop every week."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {events.map((e) => (
            <CtfEventCard key={e.id} event={e} />
          ))}
        </div>
      )}
    </div>
  );
}
