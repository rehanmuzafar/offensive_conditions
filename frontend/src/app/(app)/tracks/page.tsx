"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Route, Lock, CheckCircle2 } from "lucide-react";

import { Skeleton } from "@/components/ui/card";
import { useTracks } from "@/hooks/use-content";
import { cn } from "@/lib/cn";
import type { Track, TrackDifficulty } from "@/types/content";

const DIFF_LABEL: Record<TrackDifficulty, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
  expert: "Expert",
};

const DIFF_COLOR: Record<TrackDifficulty, string> = {
  beginner: "text-success bg-success/12",
  intermediate: "text-info bg-info/12",
  advanced: "text-warning bg-warning/12",
  expert: "text-danger bg-danger/12",
};

const FILTERS: { value: TrackDifficulty | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
  { value: "expert", label: "Expert" },
];

function TrackCard({ track }: { track: Track }) {
  const pct = track.progress
    ? Math.round((track.progress.completed / track.progress.total) * 100)
    : 0;

  return (
    <Link href={`/tracks/${track.slug}`} className="block group">
      <div className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface transition-all duration-200 hover:border-accent/60 hover:shadow-glow">
        {/* header bar */}
        <div className="h-2 w-full" style={{ background: track.thumbnailColor }} />

        <div className="flex flex-1 flex-col p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("rounded-md px-2 py-0.5 text-[11px] font-semibold", DIFF_COLOR[track.difficulty])}>
                  {DIFF_LABEL[track.difficulty]}
                </span>
                {track.isNew && (
                  <span className="rounded-md bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent">New</span>
                )}
                {track.isFree && (
                  <span className="rounded-md bg-success/12 px-2 py-0.5 text-[11px] font-semibold text-success">Free</span>
                )}
              </div>
              <h3 className="mt-2 font-display text-[16px] font-bold leading-snug">{track.name}</h3>
            </div>
            {!track.isFree && (
              <Lock className="mt-1 h-4 w-4 shrink-0 text-text-faint" />
            )}
          </div>

          <p className="mt-2 flex-1 text-[13px] leading-relaxed text-text-dim line-clamp-3">
            {track.description}
          </p>

          <div className="mt-4 flex flex-wrap gap-1.5">
            {track.tags.map((t) => (
              <span key={t} className="border border-line px-2 py-0.5 text-[11px] text-text-faint">
                {t}
              </span>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between text-[12.5px] text-text-faint">
            <span>{track.moduleCount} modules · ~{track.estimatedHours}h</span>
            {track.progress && (
              <span className="flex items-center gap-1 text-success">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {track.progress.completed}/{track.progress.total}
              </span>
            )}
          </div>

          {track.progress && (
            <div className="mt-3">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
                <div
                  className="h-full bg-accent transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

export default function TracksPage() {
  const [filter, setFilter] = useState<TrackDifficulty | "all">("all");
  const { data, isLoading } = useTracks();

  const tracks = useMemo(() => {
    const all = data?.items ?? [];
    return filter === "all" ? all : all.filter((t) => t.difficulty === filter);
  }, [data, filter]);

  const inProgress = (data?.items ?? []).filter((t) => t.progress && t.progress.completed > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2.5 font-display text-[28px] font-extrabold tracking-[-0.5px]">
            <Route className="h-6 w-6 text-text-faint" strokeWidth={1.6} /> Guided Tracks
          </h1>
          <p className="mt-1 text-[15px] text-text-dim">
            Structured paths from your first scan to advanced exploitation.
            {inProgress.length > 0 && (
              <span className="ml-1 font-semibold text-text">
                {inProgress.length} track{inProgress.length > 1 ? "s" : ""} in progress.
              </span>
            )}
          </p>
        </div>
      </div>

      {/* difficulty filter */}
      <div className="flex rounded-xl border border-line-strong p-0.5 w-fit">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={cn(
              "rounded-lg px-4 py-2 text-[13.5px] font-semibold transition-colors",
              filter === f.value ? "bg-brand-gradient text-white" : "text-text-dim hover:text-text",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[280px] w-full rounded-2xl" />
          ))}
        </div>
      ) : tracks.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line py-20 text-center">
          <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-surface-hover text-text-faint">
            <Route className="h-7 w-7" />
          </div>
          <h3 className="font-display text-[18px] font-semibold">No tracks at that level yet</h3>
          <p className="mt-1 text-[14px] text-text-dim">Try a different difficulty or check back soon.</p>
        </div>
      ) : (
        <>
          <div className="text-[13.5px] text-text-faint">
            Showing <b className="text-text">{tracks.length}</b> tracks
          </div>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {tracks.map((t) => (
              <TrackCard key={t.id} track={t} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
