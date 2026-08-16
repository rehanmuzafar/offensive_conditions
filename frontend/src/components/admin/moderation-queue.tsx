"use client";

import { Check, Trash2, Lock, Flag as FlagIcon, MessageSquare, FileText, MessagesSquare } from "lucide-react";

import { Card, CardBody, Skeleton } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useFlaggedContent, useModerate } from "@/hooks/use-admin";
import { formatRelative } from "@/lib/format";
import type { FlaggedContent } from "@/types/admin";

const KIND_ICON: Record<FlaggedContent["kind"], React.ReactNode> = {
  thread: <MessagesSquare className="h-4 w-4" />,
  post: <MessageSquare className="h-4 w-4" />,
  writeup: <FileText className="h-4 w-4" />,
};

/**
 * Shared moderation queue, filtered by content kind. Forum admin shows
 * thread+post, writeups admin shows writeup.
 */
export function ModerationQueue({ kinds, emptyLabel }: { kinds: FlaggedContent["kind"][]; emptyLabel: string }) {
  const { data, isLoading } = useFlaggedContent();
  const moderate = useModerate();

  const items = (data ?? []).filter((f) => kinds.includes(f.kind));

  if (isLoading) return <Skeleton className="h-80 w-full rounded-2xl" />;

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line py-16 text-center">
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-success/12 text-success">
          <Check className="h-6 w-6" />
        </div>
        <p className="text-[15px] font-medium">All clear</p>
        <p className="mt-1 text-[13.5px] text-text-dim">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((f) => (
        <Card key={f.id}>
          <CardBody>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex items-center gap-1.5 rounded-md bg-surface-hover px-2 py-0.5 text-[11.5px] font-semibold capitalize text-text-dim">
                    {KIND_ICON[f.kind]} {f.kind}
                  </span>
                  <span className="flex items-center gap-1 rounded-full bg-danger/12 px-2 py-0.5 text-[11px] font-semibold text-danger">
                    <FlagIcon className="h-3 w-3" /> {f.reportCount} reports
                  </span>
                  <span className="text-[12px] text-text-faint">· {f.reason}</span>
                </div>
                <h3 className="mt-2 font-display text-[15.5px] font-semibold">{f.title}</h3>
                <p className="mt-1 line-clamp-2 rounded-lg bg-bg-elevated px-3 py-2 text-[13px] italic text-text-dim">“{f.excerpt}”</p>
                <div className="mt-2 text-[12px] text-text-faint">
                  by <b className="text-text-dim">{f.author}</b> · reported by {f.reportedBy} · {formatRelative(f.at)}
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
              <Button variant="ghost" size="sm" loading={moderate.isPending && moderate.variables?.id === f.id && moderate.variables?.action === "approve"} onClick={() => moderate.mutate({ id: f.id, action: "approve" })}>
                <Check className="h-4 w-4" /> Approve (dismiss)
              </Button>
              {f.kind !== "writeup" && (
                <Button variant="ghost" size="sm" onClick={() => moderate.mutate({ id: f.id, action: "lock" })}>
                  <Lock className="h-4 w-4" /> Lock
                </Button>
              )}
              <Button variant="danger" size="sm" loading={moderate.isPending && moderate.variables?.id === f.id && moderate.variables?.action === "remove"} onClick={() => moderate.mutate({ id: f.id, action: "remove" })}>
                <Trash2 className="h-4 w-4" /> Remove
              </Button>
            </div>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
