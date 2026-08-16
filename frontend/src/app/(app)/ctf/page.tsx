"use client";

import { useState, useMemo } from "react";
import { Flag } from "lucide-react";

import { CtfEventCard } from "@/components/ctf/ctf-event-card";
import { Skeleton } from "@/components/ui/card";
import { useCtfEvents } from "@/hooks/use-community";
import { cn } from "@/lib/cn";
import type { CtfState } from "@/types/ctf";

const TABS: { value: CtfState | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "live", label: "Live now" },
  { value: "upcoming", label: "Upcoming" },
  { value: "ended", label: "Past" },
];

export default function CtfPage() {
  const [tab, setTab] = useState<CtfState | "all">("all");
  const { data, isLoading } = useCtfEvents();

  const events = useMemo(() => {
    const all = data?.items ?? [];
    return tab === "all" ? all : all.filter((e) => e.state === tab);
  }, [data, tab]);

  const liveCount = (data?.items ?? []).filter((e) => e.state === "live").length;

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
      <div className="flex rounded-xl border border-line-strong p-0.5 w-fit">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={cn(
              "rounded-lg px-4 py-2 text-[13.5px] font-semibold transition-colors",
              tab === t.value ? "bg-brand-gradient text-white" : "text-text-dim hover:text-text",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

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
          <h3 className="font-display text-[18px] font-semibold">No {tab !== "all" ? tab : ""} events right now</h3>
          <p className="mt-1 text-[14px] text-text-dim">Check back soon — new events drop every week.</p>
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
