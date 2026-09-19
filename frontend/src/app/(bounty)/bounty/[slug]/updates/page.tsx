"use client";

/**
 * Program updates — what the program has told its hackers.
 *
 * A reverse-chronological log. Newly added assets and newly excluded ones are
 * the two most valuable things a program can announce, so this is worth its own
 * page rather than a banner that scrolls past.
 */

import { use } from "react";

import { Card, CardBody, Skeleton } from "@/components/ui/card";
import { Markdown } from "@/components/ui/markdown";
import { useProgramUpdates } from "@/hooks/use-account";
import { formatRelative } from "@/lib/format";

export default function ProgramUpdatesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { data: updates = [], isLoading } = useProgramUpdates(slug);

  if (isLoading) return <Skeleton className="h-72 w-full rounded-2xl" />;

  if (updates.length === 0) {
    return (
      <Card className="p-12 text-center">
        <p className="font-display text-[17px] font-bold">No updates yet</p>
        <p className="mt-1.5 text-[13.5px] text-text-dim">
          Scope changes and announcements from this program will appear here.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {updates.map((u) => (
        <Card key={u.id}>
          <CardBody>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display text-[17px] font-bold tracking-[-0.3px]">{u.title}</h2>
              <span className="text-[12px] text-text-faint">
                {formatRelative(u.createdAt)}
                {u.authorName && ` · ${u.authorName}`}
              </span>
            </div>
            <div className="mt-3">
              <Markdown>{u.bodyMd}</Markdown>
            </div>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
