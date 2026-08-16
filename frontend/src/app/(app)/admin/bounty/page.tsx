"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Target, AlertTriangle, Clock } from "lucide-react";

import { Card, Skeleton } from "@/components/ui/card";
import { SeverityBadge, ReportStateBadge } from "@/components/bounty/status-badges";
import { useReportQueue } from "@/hooks/use-admin";
import { cn } from "@/lib/cn";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "submitted", label: "New" },
  { value: "triaging", label: "Triaging" },
  { value: "breached", label: "SLA breached" },
];

export default function AdminBountyPage() {
  const [filter, setFilter] = useState("all");
  const { data, isLoading } = useReportQueue();

  const reports = useMemo(() => {
    const all = data?.items ?? [];
    if (filter === "all") return all;
    if (filter === "breached") return all.filter((r) => r.slaBreached);
    return all.filter((r) => r.state === filter);
  }, [data, filter]);

  const breachedCount = (data?.items ?? []).filter((r) => r.slaBreached).length;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="flex items-center gap-2 font-display text-[20px] font-bold">
          <Target className="h-5 w-5 text-accent" /> Bounty triage
        </h2>
        <p className="mt-1 text-[13.5px] text-text-dim">
          Review incoming reports. {breachedCount > 0 && <span className="font-semibold text-danger">{breachedCount} past SLA.</span>}
        </p>
      </div>

      <div className="flex flex-wrap rounded-xl border border-line-strong p-0.5 w-fit">
        {FILTERS.map((f) => (
          <button key={f.value} onClick={() => setFilter(f.value)} className={cn("rounded-lg px-3.5 py-1.5 text-[13px] font-semibold transition-colors", filter === f.value ? "bg-brand-gradient text-white" : "text-text-dim hover:text-text")}>
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <Skeleton className="h-96 w-full rounded-2xl" />
      ) : (
        <Card className="overflow-hidden p-0">
          {reports.map((r) => (
            <Link key={r.id} href={`/admin/bounty/${r.id}`} className="block border-b border-line last:border-0">
              <div className={cn("flex items-start gap-4 px-5 py-4 transition-colors hover:bg-surface-hover", r.slaBreached && "bg-danger/[0.03]")}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="rounded bg-surface-hover px-1.5 py-0.5 font-mono text-[11.5px] text-text-dim">{r.shortId}</code>
                    <SeverityBadge severity={r.severity} />
                    {r.slaBreached && (
                      <span className="flex items-center gap-1 rounded-full bg-danger/12 px-2 py-0.5 text-[11px] font-semibold text-danger">
                        <AlertTriangle className="h-3 w-3" /> SLA breached
                      </span>
                    )}
                  </div>
                  <h3 className="mt-1.5 font-display text-[15px] font-semibold leading-snug">{r.title}</h3>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[12.5px] text-text-faint">
                    <span>{r.programName}</span>
                    <span>by {r.reporter}</span>
                    {r.assignedTo && <span>· assigned to {r.assignedTo}</span>}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <ReportStateBadge state={r.state} />
                  <span className={cn("flex items-center gap-1 text-[12px]", r.slaBreached ? "text-danger" : "text-text-faint")}>
                    <Clock className="h-3.5 w-3.5" /> {r.ageHours}h old
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}
