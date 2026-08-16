"use client";

/**
 * The arena's right column: your team, then the whole event.
 *
 * Chat and activity share one panel because they answer the same question from
 * two sides — "what is my team doing" and "what is everyone else doing" — and a
 * player glances between them constantly.
 */

import { useState } from "react";

import { GlobalActivity } from "@/components/ctf/global-activity";
import { InlineTeamChat } from "@/components/ctf/team-chat";
import { cn } from "@/lib/cn";

type Tab = "chat" | "activity";

export function TeamRail({ eventId }: { eventId: string }) {
  const [tab, setTab] = useState<Tab>("chat");

  return (
    // Only pin to the viewport once the rail actually sits beside the board.
    // Stacked below it on narrower screens, a full-height panel is just a hole.
    <aside className="flex h-[460px] flex-col overflow-hidden rounded-2xl border border-line bg-surface xl:h-[calc(100vh-140px)] xl:min-h-[420px]">
      <div className="flex shrink-0 border-b border-line">
        {(
          [
            ["chat", "Team Chat"],
            ["activity", "Global Activity"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "flex-1 border-b-2 px-3 py-3 text-[13.5px] font-semibold transition-colors",
              tab === key
                ? "border-accent text-text"
                : "border-transparent text-text-dim hover:text-text",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "chat" ? <InlineTeamChat eventId={eventId} /> : <GlobalActivity eventId={eventId} />}
      </div>
    </aside>
  );
}
