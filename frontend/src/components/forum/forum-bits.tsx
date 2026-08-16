import Link from "next/link";
import { MessageSquare, Eye, Pin, Lock, CheckCircle2, ArrowBigUp } from "lucide-react";
import * as Icons from "lucide-react";

import { Card, CardBody } from "@/components/ui/card";
import { Avatar, TierBadge } from "@/components/ui/identity";
import { formatNumber, formatRelative } from "@/lib/format";
import type { ForumCategory, ForumThread } from "@/types/forum";

export function CategoryCard({ category }: { category: ForumCategory }) {
  // Resolve the lucide icon by name, fall back to MessagesSquare.
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[category.icon] ?? Icons.MessagesSquare;
  return (
    <Link href={`/forum/${category.slug}`} className="block">
      <Card interactive className="h-full">
        <CardBody className="flex items-start gap-4">
          <div
            className="grid h-12 w-12 shrink-0 place-items-center rounded-xl text-white"
            style={{ background: `linear-gradient(120deg, ${category.color}, #2563EB)` }}
          >
            <Icon className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-[17px] font-bold">{category.name}</h3>
            <p className="mt-1 line-clamp-2 text-[13.5px] text-text-dim">{category.description}</p>
            <div className="mt-2.5 flex items-center gap-4 text-[12.5px] text-text-faint">
              <span>{formatNumber(category.threadCount)} threads</span>
              <span>{formatNumber(category.postCount)} posts</span>
            </div>
          </div>
        </CardBody>
      </Card>
    </Link>
  );
}

export function ThreadRow({ thread }: { thread: ForumThread }) {
  return (
    <Link href={`/forum/thread/${thread.id}`} className="block">
      <div className="flex items-start gap-4 border-b border-line px-4 py-4 transition-colors last:border-0 hover:bg-surface-hover">
        {/* votes */}
        <div className="hidden w-12 shrink-0 flex-col items-center pt-1 sm:flex">
          <ArrowBigUp className="h-4 w-4 text-text-faint" />
          <span className="font-display text-[15px] font-bold">{thread.voteScore}</span>
        </div>

        <Avatar username={thread.author.username} src={thread.author.avatarUrl} size="md" className="mt-0.5 shrink-0" />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {thread.isPinned && <Pin className="h-3.5 w-3.5 text-accent" />}
            {thread.isLocked && <Lock className="h-3.5 w-3.5 text-text-faint" />}
            {thread.isSolved && (
              <span className="flex items-center gap-1 rounded-full bg-success/12 px-2 py-0.5 text-[10.5px] font-semibold text-success">
                <CheckCircle2 className="h-3 w-3" /> Solved
              </span>
            )}
            <h3 className="font-display text-[15.5px] font-semibold leading-snug">{thread.title}</h3>
          </div>

          <p className="mt-1 line-clamp-1 text-[13.5px] text-text-dim">{thread.excerpt}</p>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-text-faint">
            <span className="font-medium text-text-dim">{thread.author.username}</span>
            <TierBadge tier={thread.author.tier} />
            {thread.tags.slice(0, 2).map((t) => (
              <span key={t} className="rounded bg-surface-hover px-1.5 py-0.5 text-[11px] font-medium text-text-dim">
                {t}
              </span>
            ))}
            <span className="ml-auto">{formatRelative(thread.lastReplyAt)}</span>
          </div>
        </div>

        {/* counts */}
        <div className="hidden shrink-0 flex-col items-end gap-1 text-[12.5px] text-text-faint sm:flex">
          <span className="flex items-center gap-1.5"><MessageSquare className="h-3.5 w-3.5" /> {formatNumber(thread.replyCount)}</span>
          <span className="flex items-center gap-1.5"><Eye className="h-3.5 w-3.5" /> {formatNumber(thread.viewCount)}</span>
        </div>
      </div>
    </Link>
  );
}
