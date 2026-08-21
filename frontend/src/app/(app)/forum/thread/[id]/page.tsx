"use client";

import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowBigUp, ArrowBigDown, CheckCircle2, Pin, Lock, MessageSquare } from "lucide-react";

import { Card, CardBody, Skeleton } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, TierBadge } from "@/components/ui/identity";
import { Markdown } from "@/components/ui/markdown";
import { useThread, useThreadPosts, useReply } from "@/hooks/use-community";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { ForumPost } from "@/types/forum";

export default function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: thread, isLoading } = useThread(id);
  const { data: posts, isLoading: postsLoading } = useThreadPosts(id);

  if (isLoading || !thread) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-32 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link href={`/forum/${thread.categorySlug}`} className="inline-flex items-center gap-1.5 text-[14px] text-text-dim hover:text-text">
        <ArrowLeft className="h-4 w-4" /> {thread.categoryName}
      </Link>

      {/* title block */}
      <div>
        <div className="flex flex-wrap items-center gap-2">
          {thread.isPinned && <Pin className="h-4 w-4 text-accent" />}
          {thread.isLocked && <Lock className="h-4 w-4 text-text-faint" />}
          {thread.isSolved && (
            <span className="flex items-center gap-1 bg-success/12 px-2.5 py-0.5 text-[12px] font-semibold text-success">
              <CheckCircle2 className="h-3.5 w-3.5" /> Solved
            </span>
          )}
        </div>
        <h1 className="mt-2 font-display text-[26px] font-extrabold leading-tight tracking-[-0.5px]">{thread.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-text-faint">
          <span className="flex items-center gap-1.5"><MessageSquare className="h-3.5 w-3.5" /> {thread.replyCount} replies</span>
          <span>{thread.viewCount.toLocaleString()} views</span>
          <div className="flex gap-1.5">
            {thread.tags.map((t) => (
              <span key={t} className="rounded bg-surface-hover px-1.5 py-0.5 text-[11.5px] font-medium text-text-dim">{t}</span>
            ))}
          </div>
        </div>
      </div>

      {/* posts */}
      {postsLoading ? (
        <Skeleton className="h-40 w-full rounded-2xl" />
      ) : (
        <div className="space-y-4">
          {posts?.map((p) => <PostCard key={p.id} post={p} />)}
        </div>
      )}

      {/* reply box */}
      {thread.isLocked ? (
        <Card>
          <CardBody className="flex items-center gap-3 text-text-dim">
            <Lock className="h-5 w-5" />
            <span className="text-[14px]">This thread is locked. No new replies can be posted.</span>
          </CardBody>
        </Card>
      ) : (
        <ReplyBox threadId={id} />
      )}
    </div>
  );
}

function PostCard({ post }: { post: ForumPost }) {
  const [vote, setVote] = useState<1 | 0 | -1>(post.userVote);
  const score = post.voteScore + (vote - post.userVote);

  return (
    <Card className={cn(post.isAcceptedAnswer && "border-success/40", post.isOriginalPost && "border-accent/30")}>
      <CardBody className="flex gap-4">
        {/* vote rail */}
        <div className="flex shrink-0 flex-col items-center gap-1">
          <button
            onClick={() => setVote(vote === 1 ? 0 : 1)}
            className={cn("grid h-8 w-8 place-items-center rounded-lg transition-colors hover:bg-surface-hover", vote === 1 ? "text-accent" : "text-text-faint")}
            aria-label="Upvote"
          >
            <ArrowBigUp className="h-5 w-5" fill={vote === 1 ? "currentColor" : "none"} />
          </button>
          <span className="font-display text-[15px] font-bold">{score}</span>
          <button
            onClick={() => setVote(vote === -1 ? 0 : -1)}
            className={cn("grid h-8 w-8 place-items-center rounded-lg transition-colors hover:bg-surface-hover", vote === -1 ? "text-danger" : "text-text-faint")}
            aria-label="Downvote"
          >
            <ArrowBigDown className="h-5 w-5" fill={vote === -1 ? "currentColor" : "none"} />
          </button>
        </div>

        {/* body */}
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center gap-2">
            <Avatar username={post.author.username} src={post.author.avatarUrl} size="sm" />
            <span className="font-display text-[14px] font-semibold">{post.author.username}</span>
            <TierBadge tier={post.author.tier} />
            {post.isOriginalPost && <span className="rounded bg-brand-gradient-soft px-1.5 py-0.5 text-[10.5px] font-semibold text-accent">OP</span>}
            {post.isAcceptedAnswer && (
              <span className="ml-auto flex items-center gap-1 bg-success/12 px-2 py-0.5 text-[11px] font-semibold text-success">
                <CheckCircle2 className="h-3 w-3" /> Accepted answer
              </span>
            )}
            <span className={cn("text-[12px] text-text-faint", post.isAcceptedAnswer ? "" : "ml-auto")}>
              {formatRelative(post.createdAt)}
            </span>
          </div>
          <Markdown>{post.bodyMd}</Markdown>
        </div>
      </CardBody>
    </Card>
  );
}

function ReplyBox({ threadId }: { threadId: string }) {
  const reply = useReply(threadId);
  const [body, setBody] = useState("");

  function submit() {
    if (!body.trim()) return;
    reply.mutate(body, { onSuccess: () => setBody("") });
  }

  return (
    <Card>
      <CardBody>
        <h3 className="mb-3 font-display text-[16px] font-bold">Post a reply</h3>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          placeholder="Share your thoughts — Markdown supported. Remember: nudges, not spoilers."
          className="w-full resize-y rounded-xl border border-line-strong bg-bg-elevated px-3.5 py-3 text-[14.5px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[12px] text-text-faint">Markdown: **bold**, `code`, ```blocks```, &gt; quotes</span>
          <Button loading={reply.isPending} disabled={!body.trim()} onClick={submit}>
            Post reply
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
