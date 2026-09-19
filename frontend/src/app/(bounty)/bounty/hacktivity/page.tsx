"use client";

/**
 * Hacktivity — every disclosed report on the platform.
 *
 * The place a hacker learns what the current bugs actually are. Filtered rather
 * than searched by default: severity and program narrow it usefully, while
 * free-text search over titles is a weak tool when every title is a one-line
 * summary of a different bug.
 */

import { useState } from "react";
import { Search } from "lucide-react";

import { HacktivityFeed } from "@/components/bounty/hacktivity-feed";
import { Skeleton } from "@/components/ui/card";
import { useHacktivity } from "@/hooks/use-account";
import { cn } from "@/lib/cn";
import type { Severity } from "@/types/bounty";

const SEVERITIES: Array<Severity | "all"> = ["all", "critical", "high", "medium", "low"];

export default function HacktivityPage() {
  const [severity, setSeverity] = useState<Severity | "all">("all");
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");

  const { data: items = [], isLoading } = useHacktivity({
    severity: severity === "all" ? undefined : severity,
    q: applied || undefined,
    limit: 50,
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-[24px] font-extrabold tracking-[-0.5px]">Hacktivity</h1>
        <p className="mt-1 text-[13.5px] text-text-dim">
          Vulnerabilities found on this platform, disclosed with the program&apos;s agreement.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setApplied(q)}
            placeholder="Search disclosed reports…"
            className="h-10 w-full rounded-xl border border-line-strong bg-bg-elevated pl-10 pr-4 text-[14px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        </div>
        <div className="flex flex-wrap rounded-xl border border-line-strong p-0.5">
          {SEVERITIES.map((s) => (
            <button
              key={s}
              onClick={() => setSeverity(s)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-[13px] font-semibold capitalize transition-colors",
                severity === s ? "bg-brand-gradient text-white" : "text-text-dim hover:text-text",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-2xl" />
          ))}
        </div>
      ) : (
        <HacktivityFeed items={items} />
      )}
    </div>
  );
}
