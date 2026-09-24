"use client";

/**
 * Weakness discovery — what kinds of bug are actually being found here.
 *
 * Built from the weakness class on real reports rather than from a published
 * CWE list, so it describes this platform rather than the industry. A static
 * top-25 would be the same on every install and tell a hacker nothing about
 * where to look.
 */

import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { Card, CardBody, Skeleton } from "@/components/ui/card";
import { useWeaknesses } from "@/hooks/use-account";

export default function WeaknessDiscoveryPage() {
  const { data: rows = [], isLoading } = useWeaknesses();
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? rows.filter((r) => r.name.toLowerCase().includes(needle)) : rows;
  }, [rows, q]);

  const max = rows[0]?.reports ?? 1;

  if (isLoading) return <Skeleton className="h-96 w-full rounded-2xl" />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-[24px] font-extrabold tracking-[-0.5px]">
          Weakness discovery
        </h1>
        <p className="mt-1 text-[13.5px] text-text-dim">
          Weakness classes ranked by how often they have been reported on this platform.
        </p>
      </div>

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-text-faint" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name…"
          className="h-10 w-full rounded-xl border border-line-strong bg-bg-elevated pl-10 pr-4 text-[14px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
      </div>

      {filtered.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="font-display text-[17px] font-bold">
            {rows.length === 0 ? "Nothing categorised yet" : "No match"}
          </p>
          <p className="mt-1.5 text-[13.5px] text-text-dim">
            {rows.length === 0
              ? "This fills in as reports are submitted with a weakness class."
              : "Try a different term."}
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <CardBody className="border-b border-line py-3">
            <div className="grid grid-cols-[1fr_90px_90px_90px] gap-3 text-[11.5px] font-semibold uppercase tracking-wide text-text-faint">
              <span>Weakness</span>
              <span className="text-right">Reports</span>
              <span className="text-right">High/Crit</span>
              <span className="text-right">Accepted</span>
            </div>
          </CardBody>
          {filtered.map((r) => (
            <div
              key={r.name}
              className="grid grid-cols-[1fr_90px_90px_90px] items-center gap-3 border-b border-line px-5 py-3 last:border-0 hover:bg-surface-hover"
            >
              <div className="min-w-0">
                <p className="truncate text-[13.5px] font-medium text-text">{r.name}</p>
                {/* A bar rather than a percentage: the useful comparison is
                    against the most-reported class, not against 100. */}
                <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-white/6">
                  <div
                    className="h-full rounded-full bg-brand-gradient"
                    style={{ width: `${Math.max(2, (r.reports / max) * 100)}%` }}
                  />
                </div>
              </div>
              <span className="text-right font-display text-[14px] font-bold tabular-nums">
                {r.reports.toLocaleString()}
              </span>
              <span className="text-right text-[13px] tabular-nums text-danger">{r.severe}</span>
              <span className="text-right text-[13px] tabular-nums text-success">{r.accepted}</span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
