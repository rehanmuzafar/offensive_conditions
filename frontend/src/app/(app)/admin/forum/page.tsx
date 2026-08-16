"use client";

import { MessagesSquare } from "lucide-react";

import { ModerationQueue } from "@/components/admin/moderation-queue";

export default function AdminForumPage() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="flex items-center gap-2 font-display text-[20px] font-bold">
          <MessagesSquare className="h-5 w-5 text-accent" /> Forum moderation
        </h2>
        <p className="mt-1 text-[13.5px] text-text-dim">Review reported threads and posts.</p>
      </div>
      <ModerationQueue kinds={["thread", "post"]} emptyLabel="No flagged forum content right now." />
    </div>
  );
}
