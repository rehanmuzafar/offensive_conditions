"use client";

/**
 * A program's disclosed reports.
 *
 * The most useful page on a program for deciding what to look at: it shows what
 * this program has actually accepted and paid for, which is a far better guide
 * than the scope table alone.
 */

import { use } from "react";

import { HacktivityFeed } from "@/components/bounty/hacktivity-feed";
import { Skeleton } from "@/components/ui/card";
import { useHacktivity } from "@/hooks/use-account";

export default function ProgramHacktivityPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const { data: items = [], isLoading } = useHacktivity({ program: slug, limit: 50 });

  if (isLoading) return <Skeleton className="h-72 w-full rounded-2xl" />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-[19px] font-bold tracking-[-0.3px]">Hacktivity</h1>
        <p className="mt-0.5 text-[13px] text-text-dim">
          Reports this program has agreed to disclose publicly.
        </p>
      </div>
      <HacktivityFeed
        items={items}
        showProgram={false}
        emptyHint="This program has not disclosed any reports yet. That is common for new programs and does not mean nothing has been found."
      />
    </div>
  );
}
