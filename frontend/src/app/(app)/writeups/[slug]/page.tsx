"use client";

import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowBigUp, ArrowBigDown, MessageSquare, Lock, Server, Flag, Share2 } from "lucide-react";

import { Card, CardBody, Skeleton } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, DifficultyBadge, OsIcon } from "@/components/ui/identity";
import { Markdown } from "@/components/ui/markdown";
import { useWriteup } from "@/hooks/use-community";
import { formatDate, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";

export default function WriteupDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { data: writeup, isLoading } = useWriteup(slug);
  const [vote, setVote] = useState<1 | 0 | -1>(0);

  if (isLoading || !writeup) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    );
  }

  const score = writeup.voteScore + (vote - writeup.userVote);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/writeups" className="inline-flex items-center gap-1.5 text-[14px] text-text-dim hover:text-text">
        <ArrowLeft className="h-4 w-4" /> All writeups
      </Link>

      {/* header */}
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-md bg-surface-hover px-2 py-1 text-[12.5px] font-medium text-text-dim">
            {writeup.target.kind === "machine" ? <Server className="h-3.5 w-3.5" /> : <Flag className="h-3.5 w-3.5" />}
            {writeup.target.name}
          </span>
          {writeup.os && <OsIcon os={writeup.os} className="h-4 w-4 text-text-faint" />}
          {writeup.difficulty && <DifficultyBadge difficulty={writeup.difficulty} />}
        </div>
        <h1 className="mt-3 font-display text-[30px] font-extrabold leading-tight tracking-[-0.5px]">{writeup.title}</h1>

        {/* author row */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Avatar username={writeup.author.username} src={writeup.author.avatarUrl} size="md" />
            <div>
              <div className="font-display text-[14.5px] font-semibold">{writeup.author.username}</div>
              <div className="text-[12.5px] text-text-faint">
                {formatDate(writeup.publishedAt)} · {writeup.readMinutes} min read
              </div>
            </div>
          </div>
          <Button variant="ghost" size="sm">
            <Share2 className="h-4 w-4" /> Share
          </Button>
        </div>
      </div>

      {/* gated content */}
      {writeup.locked ? (
        <Card>
          <CardBody className="flex flex-col items-center py-12 text-center">
            <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-surface-hover text-text-faint">
              <Lock className="h-7 w-7" />
            </div>
            <h3 className="font-display text-[20px] font-bold">This writeup is locked</h3>
            <p className="mt-2 max-w-sm text-[14.5px] text-text-dim">
              To keep things fair, you can only read the {writeup.target.name} writeup after you&apos;ve rooted it yourself.
            </p>
            <Link href={`/machines/${writeup.target.slug}`} className="mt-5">
              <Button>Go root {writeup.target.name}</Button>
            </Link>
          </CardBody>
        </Card>
      ) : (
        <>
          <Card>
            <CardBody>
              <Markdown>{writeup.bodyMd}</Markdown>
            </CardBody>
          </Card>

          {/* footer actions */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setVote(vote === 1 ? 0 : 1)}
                className={cn("flex items-center gap-1.5 rounded-xl border border-line-strong px-4 py-2 text-[14px] font-semibold transition-colors hover:bg-surface-hover", vote === 1 && "border-accent text-accent")}
              >
                <ArrowBigUp className="h-5 w-5" fill={vote === 1 ? "currentColor" : "none"} /> {formatNumber(score)}
              </button>
              <button
                onClick={() => setVote(vote === -1 ? 0 : -1)}
                className={cn("grid h-[42px] w-[42px] place-items-center rounded-xl border border-line-strong text-text-dim transition-colors hover:bg-surface-hover", vote === -1 && "border-danger text-danger")}
              >
                <ArrowBigDown className="h-5 w-5" fill={vote === -1 ? "currentColor" : "none"} />
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {writeup.tags.map((t) => (
                <span key={t} className="rounded-md bg-surface-hover px-2.5 py-1 text-[12.5px] font-medium text-text-dim">{t}</span>
              ))}
            </div>
          </div>

          {/* comments placeholder */}
          <Card>
            <CardBody>
              <h3 className="flex items-center gap-2 font-display text-[16px] font-bold">
                <MessageSquare className="h-5 w-5 text-accent" /> {writeup.commentCount} comments
              </h3>
              <p className="mt-2 text-[14px] text-text-dim">Comments are coming soon — discuss this writeup in the forum for now.</p>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
