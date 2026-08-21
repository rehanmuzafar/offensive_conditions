"use client";

import { use } from "react";
import Link from "next/link";
import {
  ArrowLeft, Route, Lock, CheckCircle2, Clock, BookOpen, Beaker, Swords, Trophy,
} from "lucide-react";

import { Card, CardBody, Skeleton } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useTrack } from "@/hooks/use-content";
import { cn } from "@/lib/cn";
import type { TrackDifficulty, TrackModule } from "@/types/content";

const DIFF_COLOR: Record<TrackDifficulty, string> = {
  beginner: "text-success bg-success/12",
  intermediate: "text-info bg-info/12",
  advanced: "text-warning bg-warning/12",
  expert: "text-danger bg-danger/12",
};

const MODULE_ICON: Record<TrackModule["type"], React.ReactNode> = {
  theory: <BookOpen className="h-4 w-4" />,
  lab: <Beaker className="h-4 w-4" />,
  challenge: <Swords className="h-4 w-4" />,
  boss: <Trophy className="h-4 w-4 text-warning" />,
};

export default function TrackDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { data: track, isLoading } = useTrack(slug);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48 rounded-xl" />
        <Skeleton className="h-40 w-full rounded-2xl" />
        <div className="grid gap-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (!track) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <Route className="mb-4 h-12 w-12 text-text-faint" />
        <h2 className="font-display text-[20px] font-semibold">Track not found</h2>
        <Link href="/tracks"><Button variant="ghost" className="mt-4">Back to tracks</Button></Link>
      </div>
    );
  }

  const completed = track.progress?.completed ?? 0;
  const total = track.progress?.total ?? track.moduleCount;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="space-y-6">
      <Link href="/tracks" className="inline-flex items-center gap-2 text-[14px] text-text-dim hover:text-text">
        <ArrowLeft className="h-4 w-4" /> All tracks
      </Link>

      {/* hero card */}
      <Card className="overflow-hidden p-0">
        <div className="h-2 w-full" style={{ background: track.thumbnailColor }} />
        <CardBody>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("rounded-md px-2 py-0.5 text-[11px] font-semibold", DIFF_COLOR[track.difficulty])}>
                  {track.difficulty.charAt(0).toUpperCase() + track.difficulty.slice(1)}
                </span>
                {track.isNew && (
                  <span className="rounded-md bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent">New</span>
                )}
                {track.isFree
                  ? <span className="rounded-md bg-success/12 px-2 py-0.5 text-[11px] font-semibold text-success">Free</span>
                  : <span className="rounded-md bg-line px-2 py-0.5 text-[11px] font-semibold text-text-faint">Pro</span>
                }
              </div>
              <h1 className="mt-3 font-display text-[26px] font-extrabold tracking-[-0.5px]">{track.name}</h1>
              <p className="mt-2 max-w-2xl text-[15px] text-text-dim">{track.longDescription}</p>
            </div>
            <Button size="lg" className="shrink-0">
              {completed > 0 ? "Continue" : "Start track"}
            </Button>
          </div>

          <div className="mt-5 flex flex-wrap gap-5 text-[13.5px] text-text-dim">
            <span className="flex items-center gap-1.5"><Route className="h-4 w-4" /> {track.moduleCount} modules</span>
            <span className="flex items-center gap-1.5"><Clock className="h-4 w-4" /> ~{track.estimatedHours}h</span>
            {track.progress && (
              <span className="flex items-center gap-1.5 text-success"><CheckCircle2 className="h-4 w-4" /> {completed}/{total} completed</span>
            )}
          </div>

          {track.progress && (
            <div className="mt-4">
              <div className="mb-1 flex justify-between text-[12px] text-text-faint">
                <span>Progress</span><span>{pct}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-line">
                <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}

          {track.skills.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {track.skills.map((s) => (
                <span key={s} className="border border-line px-2.5 py-0.5 text-[11px] text-text-faint">{s}</span>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* modules list */}
      <div>
        <h2 className="mb-3 font-display text-[18px] font-bold">Modules</h2>
        <div className="space-y-2">
          {track.modules.map((mod) => (
            <div
              key={mod.id}
              className={cn(
                "flex items-center gap-4 rounded-xl border px-4 py-3 transition-colors",
                mod.completed
                  ? "border-success/30 bg-success/5"
                  : mod.isLocked
                  ? "border-line bg-surface opacity-60"
                  : "border-line bg-surface hover:border-accent/50",
              )}
            >
              <div className={cn(
                "grid h-8 w-8 shrink-0 place-items-center rounded-lg",
                mod.completed ? "bg-success/15 text-success" : "bg-surface-hover text-text-faint",
              )}>
                {mod.completed ? <CheckCircle2 className="h-4 w-4" /> : MODULE_ICON[mod.type]}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[13.5px] font-semibold truncate">{mod.title}</span>
                  <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide bg-surface-hover text-text-faint">
                    {mod.type}
                  </span>
                </div>
                <p className="text-[12px] text-text-faint">{mod.estimatedMinutes} min</p>
              </div>
              {mod.isLocked ? (
                <Lock className="h-4 w-4 shrink-0 text-text-faint" />
              ) : !mod.completed ? (
                <Button size="sm" variant="ghost">Start</Button>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
