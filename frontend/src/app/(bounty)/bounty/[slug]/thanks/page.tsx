"use client";

/**
 * Thanks — who found what here.
 *
 * The top three get a podium and everyone else a numbered list, because the
 * page exists to be a credit, and a flat table of forty names credits nobody in
 * particular. Ranked by severity-weighted reputation rather than report count:
 * see `ProgramService.thanks` for the weights.
 */

import { use } from "react";
import Link from "next/link";
import { Crown } from "lucide-react";

import { Avatar } from "@/components/ui/identity";
import { Card, CardBody, Skeleton } from "@/components/ui/card";
import { useProgramThanks } from "@/hooks/use-account";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { ThanksEntry } from "@/types/bounty";

const PLACE = [
  { ring: "ring-warning/60", chip: "bg-warning/15 text-warning", order: "sm:order-2" },
  { ring: "ring-text-faint/50", chip: "bg-white/8 text-text-dim", order: "sm:order-1" },
  { ring: "ring-accent/50", chip: "bg-accent/12 text-accent", order: "sm:order-3" },
];

export default function ProgramThanksPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { data: entries = [], isLoading } = useProgramThanks(slug);

  if (isLoading) return <Skeleton className="h-96 w-full rounded-2xl" />;

  if (entries.length === 0) {
    return (
      <Card className="p-12 text-center">
        <p className="font-display text-[17px] font-bold">No one to thank yet</p>
        <p className="mt-1.5 text-[13.5px] text-text-dim">
          The first accepted report puts someone here.
        </p>
      </Card>
    );
  }

  const podium = entries.slice(0, 3);
  const rest = entries.slice(3);

  return (
    <div className="space-y-5">
      <Card>
        <CardBody>
          <h1 className="font-display text-[19px] font-bold tracking-[-0.3px]">Thanks</h1>
          <p className="mt-0.5 text-[13px] text-text-dim">
            Ranked by severity-weighted reputation earned on this program.
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-3 sm:items-end">
            {podium.map((e, i) => (
              <PodiumCard key={e.researcherId} entry={e} place={i} />
            ))}
          </div>
        </CardBody>
      </Card>

      {rest.length > 0 && (
        <Card className="overflow-hidden p-0">
          {rest.map((e, i) => (
            <div
              key={e.researcherId}
              className="flex items-center gap-3 border-b border-line px-5 py-3 last:border-0 hover:bg-surface-hover"
            >
              <span className="w-7 shrink-0 text-center font-display text-[13px] font-bold text-text-faint">
                {i + 4}
              </span>
              <Avatar username={e.username} size="sm" className="shrink-0" />
              <Link
                href={`/u/${e.username}`}
                className="min-w-0 flex-1 truncate font-display text-[14px] font-semibold hover:text-accent"
              >
                {e.username}
              </Link>
              <span className="shrink-0 text-[12.5px] text-text-faint">
                {e.accepted} accepted
              </span>
              <span className="w-16 shrink-0 text-right font-display text-[14px] font-bold text-gradient">
                {e.reputation}
              </span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function PodiumCard({ entry, place }: { entry: ThanksEntry; place: number }) {
  const style = PLACE[place]!;
  return (
    <div
      className={cn(
        "edge-iridescent group glass rounded-2xl px-4 pb-5 pt-7 text-center transition-transform duration-300 hover:-translate-y-1",
        style.order,
        place === 0 && "sm:pb-7 sm:pt-9",
      )}
    >
      <div className="relative mx-auto w-fit">
        {place === 0 && (
          <Crown className="absolute -top-6 left-1/2 h-5 w-5 -translate-x-1/2 text-warning" />
        )}
        <Avatar
          username={entry.username}
          size={place === 0 ? "lg" : "md"}
          className={cn("ring-2 ring-offset-2 ring-offset-bg", style.ring)}
        />
        <span
          className={cn(
            "absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full text-[11px] font-bold",
            style.chip,
          )}
        >
          {place + 1}
        </span>
      </div>

      <Link
        href={`/u/${entry.username}`}
        className="mt-3 block truncate font-display text-[15px] font-bold hover:text-accent"
      >
        {entry.username}
      </Link>
      <p className="mt-0.5 font-display text-[18px] font-extrabold text-gradient">
        {entry.reputation}
      </p>
      <p className="mt-1 text-[12px] text-text-faint">
        {entry.accepted} accepted
        {entry.criticals > 0 && ` · ${entry.criticals} critical`}
      </p>
      {entry.earnedCents > 0 && (
        <p className="mt-0.5 text-[12px] text-success">
          {formatMoney(entry.earnedCents, "USD")} earned
        </p>
      )}
    </div>
  );
}
