import Link from "next/link";
import { Clock, ArrowBigUp, MessageSquare, Lock, Server, Flag } from "lucide-react";

import { Card, CardBody } from "@/components/ui/card";
import { Avatar } from "@/components/ui/identity";
import { DifficultyBadge, OsIcon } from "@/components/ui/identity";
import type { Writeup } from "@/types/forum";

export function WriteupCard({ writeup }: { writeup: Writeup }) {
  return (
    <Link href={`/writeups/${writeup.slug}`} className="block">
      <Card interactive className="h-full">
        <CardBody>
          {/* target chip */}
          <div className="mb-3 flex items-center justify-between">
            <span className="flex items-center gap-1.5 rounded-md bg-surface-hover px-2 py-1 text-[12px] font-medium text-text-dim">
              {writeup.target.kind === "machine" ? <Server className="h-3.5 w-3.5" /> : <Flag className="h-3.5 w-3.5" />}
              {writeup.target.name}
            </span>
            <div className="flex items-center gap-1.5">
              {writeup.os && <OsIcon os={writeup.os} className="h-4 w-4 text-text-faint" />}
              {writeup.difficulty && <DifficultyBadge difficulty={writeup.difficulty} />}
            </div>
          </div>

          <h3 className="font-display text-[17px] font-bold leading-snug">
            {writeup.locked && <Lock className="mr-1.5 inline h-3.5 w-3.5 -translate-y-0.5 text-text-faint" />}
            {writeup.title}
          </h3>
          <p className="mt-2 line-clamp-2 text-[13.5px] text-text-dim">{writeup.excerpt}</p>

          <div className="mt-4 flex flex-wrap gap-1.5">
            {writeup.tags.slice(0, 3).map((t) => (
              <span key={t} className="rounded bg-surface-hover px-1.5 py-0.5 text-[11px] font-medium text-text-dim">{t}</span>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
            <div className="flex items-center gap-2">
              <Avatar username={writeup.author.username} src={writeup.author.avatarUrl} size="sm" />
              <span className="text-[13px] font-medium">{writeup.author.username}</span>
            </div>
            <div className="flex items-center gap-3 text-[12px] text-text-faint">
              <span className="flex items-center gap-1"><ArrowBigUp className="h-3.5 w-3.5" /> {writeup.voteScore}</span>
              <span className="flex items-center gap-1"><MessageSquare className="h-3.5 w-3.5" /> {writeup.commentCount}</span>
              <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {writeup.readMinutes}m</span>
            </div>
          </div>
        </CardBody>
      </Card>
    </Link>
  );
}
