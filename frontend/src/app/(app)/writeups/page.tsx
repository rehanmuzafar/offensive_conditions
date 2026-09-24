"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { BookOpen, Plus, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/card";
import { WriteupCard } from "@/components/writeups/writeup-card";
import { useWriteups } from "@/hooks/use-community";
import { cn } from "@/lib/cn";
import type { WriteupQuery } from "@/lib/community-api";

export default function WriteupsPage() {
  const [sort, setSort] = useState<NonNullable<WriteupQuery["sort"]>>("latest");
  const [q, setQ] = useState("");
  const { data, isLoading } = useWriteups({ sort });

  const writeups = useMemo(() => {
    let list = data?.items ?? [];
    if (q) {
      const needle = q.toLowerCase();
      list = list.filter(
        (w) => w.title.toLowerCase().includes(needle) || w.tags.some((t) => t.toLowerCase().includes(needle)) || w.target.name.toLowerCase().includes(needle),
      );
    }
    const sorted = [...list];
    if (sort === "top") sorted.sort((a, b) => b.voteScore - a.voteScore);
    else sorted.sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt));
    return sorted;
  }, [data, q, sort]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2.5 font-display text-[28px] font-extrabold tracking-[-0.5px]">
            <BookOpen className="h-6 w-6 text-text-faint" strokeWidth={1.6} /> Writeups
          </h1>
          <p className="mt-1 text-[15px] text-text-dim">Solution walkthroughs — readable once you&apos;ve rooted the target yourself.</p>
        </div>
        <Link href="/writeups/new">
          <Button>
            <Plus className="h-[18px] w-[18px]" /> Publish writeup
          </Button>
        </Link>
      </div>

      {/* controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search writeups…"
            className="h-10 w-full rounded-xl border border-line-strong bg-bg-elevated pl-10 pr-4 text-[14px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        </div>
        <div className="flex rounded-xl border border-line-strong p-0.5">
          {(["latest", "top"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSort(s)}
              className={cn(
                "rounded-lg px-4 py-1.5 text-[13px] font-semibold capitalize transition-colors",
                sort === s ? "bg-brand-gradient text-white" : "text-text-dim hover:text-text",
              )}
            >
              {s === "latest" ? "Latest" : "Top rated"}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-56 w-full rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {writeups.map((w) => (
            <WriteupCard key={w.id} writeup={w} />
          ))}
        </div>
      )}
    </div>
  );
}
