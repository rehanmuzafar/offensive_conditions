"use client";

import { BookOpen } from "lucide-react";

import { ModerationQueue } from "@/components/admin/moderation-queue";

export default function AdminWriteupsPage() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="flex items-center gap-2 font-display text-[20px] font-bold">
          <BookOpen className="h-5 w-5 text-accent" /> Writeup moderation
        </h2>
        <p className="mt-1 text-[13.5px] text-text-dim">Review reported writeups — especially flag leaks and spoilers.</p>
      </div>
      <ModerationQueue kinds={["writeup"]} emptyLabel="No flagged writeups right now." />
    </div>
  );
}
