"use client";

/**
 * The event's pulse: every solve, newest first.
 *
 * Polls rather than relying on the websocket alone, because a player who opens
 * the tab mid-event needs the history, not just what happens next.
 */

import { useQuery } from "@tanstack/react-query";
import { Droplet } from "lucide-react";

import { activityApi, type ActivityItem } from "@/lib/activity-api";
import { cn } from "@/lib/cn";

export function GlobalActivity({ eventId }: { eventId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["ctf-activity", eventId],
    queryFn: () => activityApi.list(eventId),
    refetchInterval: 20_000,
  });

  if (isLoading) {
    return <p className="px-4 py-8 text-center text-[13px] text-text-faint">Loading activity…</p>;
  }
  if (error) {
    return (
      <p className="px-4 py-8 text-center text-[13px] text-text-faint">
        Activity is unavailable right now.
      </p>
    );
  }
  if (!data || data.length === 0) {
    return (
      <div className="px-4 py-10 text-center">
        <p className="text-[14px] font-semibold text-text">Nothing solved yet</p>
        <p className="mt-1 text-[13px] text-text-dim">
          The first flag of the event will show up here.
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-line">
      {data.map((a) => (
        <Row key={`${a.challenge_id}-${a.solved_at}`} item={a} />
      ))}
    </ul>
  );
}

function Row({ item }: { item: ActivityItem }) {
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span
        className={cn(
          "mt-1 h-2 w-2 shrink-0 rounded-full",
          item.is_first_blood ? "bg-danger" : "bg-accent",
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] leading-snug text-text-dim">
          <span className="font-semibold text-text">{item.actor || "A player"}</span> pwned{" "}
          <span className="font-semibold text-text">{item.challenge_name}</span>
        </p>
        <p className="mt-0.5 flex items-center gap-2 text-[11.5px] text-text-faint">
          <span className="capitalize">{item.category}</span>
          <span>·</span>
          <span>{timeAgo(item.solved_at)}</span>
          {item.is_first_blood && (
            <span className="inline-flex items-center gap-1 font-semibold text-danger">
              <Droplet className="h-3 w-3" /> first blood
            </span>
          )}
        </p>
      </div>
    </li>
  );
}

/** Relative time reads better than a clock in a feed you scan. */
function timeAgo(iso: string): string {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
