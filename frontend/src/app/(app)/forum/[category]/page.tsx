"use client";

import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, Skeleton } from "@/components/ui/card";
import { ThreadRow } from "@/components/forum/forum-bits";
import { useForumCategories, useThreads } from "@/hooks/use-community";
import { cn } from "@/lib/cn";
import type { ThreadQuery } from "@/lib/community-api";

const SORTS: { value: NonNullable<ThreadQuery["sort"]>; label: string }[] = [
  { value: "latest", label: "Latest" },
  { value: "top", label: "Top" },
  { value: "unanswered", label: "Unanswered" },
];

export default function ForumCategoryPage({ params }: { params: Promise<{ category: string }> }) {
  const { category } = use(params);
  const [sort, setSort] = useState<NonNullable<ThreadQuery["sort"]>>("latest");
  const { data: categories } = useForumCategories();
  const { data: threads, isLoading } = useThreads({ category, sort });

  const cat = categories?.find((c) => c.slug === category);
  // Mock fallback returns all threads; filter to this category client-side.
  const rows = (threads?.items ?? []).filter((t) => t.categorySlug === category || !categories);

  return (
    <div className="space-y-6">
      <Link href="/forum" className="inline-flex items-center gap-1.5 text-[14px] text-text-dim hover:text-text">
        <ArrowLeft className="h-4 w-4" /> All categories
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[26px] font-extrabold tracking-[-0.5px]">{cat?.name ?? category}</h1>
          {cat && <p className="mt-1 text-[14.5px] text-text-dim">{cat.description}</p>}
        </div>
        <Link href={`/forum/new?category=${category}`}>
          <Button>
            <Plus className="h-[18px] w-[18px]" /> New thread
          </Button>
        </Link>
      </div>

      {/* sort */}
      <div className="flex rounded-xl border border-line-strong p-0.5 w-fit">
        {SORTS.map((s) => (
          <button
            key={s.value}
            onClick={() => setSort(s.value)}
            className={cn(
              "rounded-lg px-4 py-1.5 text-[13px] font-semibold transition-colors",
              sort === s.value ? "bg-brand-gradient text-white" : "text-text-dim hover:text-text",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <Skeleton className="h-96 w-full rounded-2xl" />
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line py-16 text-center">
          <p className="text-[15px] text-text-dim">No threads here yet. Start the first discussion!</p>
        </div>
      ) : (
        <Card className="overflow-hidden p-0">
          {rows.map((t) => (
            <ThreadRow key={t.id} thread={t} />
          ))}
        </Card>
      )}
    </div>
  );
}
