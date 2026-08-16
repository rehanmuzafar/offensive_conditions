"use client";

import Link from "next/link";
import { MessagesSquare, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, Skeleton } from "@/components/ui/card";
import { CategoryCard, ThreadRow } from "@/components/forum/forum-bits";
import { useForumCategories, useThreads } from "@/hooks/use-community";

export default function ForumPage() {
  const { data: categories, isLoading: catsLoading } = useForumCategories();
  const { data: threads, isLoading: threadsLoading } = useThreads({ sort: "latest" });

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2.5 font-display text-[28px] font-extrabold tracking-[-0.5px]">
            <MessagesSquare className="h-7 w-7 text-accent" /> Forum
          </h1>
          <p className="mt-1 text-[15px] text-text-dim">Ask, discuss, and learn from the community. No spoilers — just nudges.</p>
        </div>
        <Link href="/forum/new">
          <Button>
            <Plus className="h-[18px] w-[18px]" /> New thread
          </Button>
        </Link>
      </div>

      {/* categories */}
      <div>
        <h2 className="mb-4 font-display text-[18px] font-bold">Categories</h2>
        {catsLoading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full rounded-2xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {categories?.map((c) => (
              <CategoryCard key={c.slug} category={c} />
            ))}
          </div>
        )}
      </div>

      {/* recent threads */}
      <div>
        <h2 className="mb-4 font-display text-[18px] font-bold">Recent discussions</h2>
        {threadsLoading ? (
          <Skeleton className="h-80 w-full rounded-2xl" />
        ) : (
          <Card className="overflow-hidden p-0">
            {threads?.items.map((t) => (
              <ThreadRow key={t.id} thread={t} />
            ))}
          </Card>
        )}
      </div>
    </div>
  );
}
