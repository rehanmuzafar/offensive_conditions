"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, FileText, Search } from "lucide-react";

import { Card, Skeleton } from "@/components/ui/card";
import { SeverityBadge, ReportStateBadge } from "@/components/bounty/status-badges";
import { useMyReports } from "@/hooks/use-account";
import { formatMoney, formatRelative } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { ReportState } from "@/types/bounty";

const FILTERS: { value: ReportState | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "triaging", label: "Triaging" },
  { value: "accepted", label: "Accepted" },
  { value: "paid", label: "Paid" },
  { value: "resolved", label: "Resolved" },
];

export default function MyReportsPage() {
  const [filter, setFilter] = useState<ReportState | "all">("all");
  const [q, setQ] = useState("");
  const { data, isLoading } = useMyReports();

  const reports = useMemo(() => {
    let list = data?.items ?? [];
    if (filter !== "all") list = list.filter((r) => r.state === filter);
    if (q) {
      const needle = q.toLowerCase();
      list = list.filter((r) => r.title.toLowerCase().includes(needle) || r.shortId.toLowerCase().includes(needle) || r.programName.toLowerCase().includes(needle));
    }
    return list;
  }, [data, filter, q]);

  const totalEarned = (data?.items ?? []).filter((r) => r.bountyCents > 0).reduce((sum, r) => sum + r.bountyCents, 0);

  return (
    <div className="space-y-6">
      <Link href="/bounty" className="inline-flex items-center gap-1.5 text-[14px] text-text-dim hover:text-text">
        <ArrowLeft className="h-4 w-4" /> Bug bounties
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2.5 font-display text-[28px] font-extrabold tracking-[-0.5px]">
            <FileText className="h-6 w-6 text-text-faint" strokeWidth={1.6} /> My reports
          </h1>
          <p className="mt-1 text-[15px] text-text-dim">Track the status of every vulnerability you&apos;ve submitted.</p>
        </div>
        {totalEarned > 0 && (
          <Card className="px-5 py-3">
            <div className="text-[12px] text-text-faint">Total earned</div>
            <div className="font-display text-[22px] font-extrabold text-gradient">{formatMoney(totalEarned, "USD")}</div>
          </Card>
        )}
      </div>

      {/* controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap rounded-xl border border-line-strong p-0.5">
          {FILTERS.map((f) => (
            <button key={f.value} onClick={() => setFilter(f.value)} className={cn("rounded-lg px-3.5 py-1.5 text-[13px] font-semibold transition-colors", filter === f.value ? "bg-brand-gradient text-white" : "text-text-dim hover:text-text")}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative max-w-xs flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search reports…" className="h-10 w-full rounded-xl border border-line-strong bg-bg-elevated pl-10 pr-4 text-[14px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30" />
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-96 w-full rounded-2xl" />
      ) : reports.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line py-16 text-center">
          <p className="text-[15px] text-text-dim">No reports{filter !== "all" ? ` in "${filter}"` : " yet"}. Find a program and start hunting!</p>
        </div>
      ) : (
        <Card className="overflow-hidden p-0">
          {reports.map((r) => (
            <Link key={r.id} href={`/bounty/reports/${r.id}`} className="block">
              <div className="flex items-center gap-4 border-b border-line px-5 py-4 transition-colors last:border-0 hover:bg-surface-hover">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="font-mono text-[12.5px] font-semibold text-text-faint">{r.shortId}</code>
                    <SeverityBadge severity={r.severity} />
                    {r.cvssScore != null && <span className="text-[12px] font-medium text-text-faint">CVSS {r.cvssScore}</span>}
                  </div>
                  <h3 className="mt-1 truncate font-display text-[15.5px] font-semibold">{r.title}</h3>
                  <div className="mt-1 flex items-center gap-2 text-[12.5px] text-text-faint">
                    <span>{r.programName}</span>
                    <span>·</span>
                    <span>{formatRelative(r.createdAt)}</span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <ReportStateBadge state={r.state} />
                  {r.bountyCents > 0 && (
                    <span className="font-display text-[15px] font-bold text-success">{formatMoney(r.bountyCents, r.bountyCurrency ?? "USD")}</span>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}
