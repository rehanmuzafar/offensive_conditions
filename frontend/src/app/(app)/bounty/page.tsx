"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Target, Search, FileText, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/card";
import { ProgramCard } from "@/components/bounty/program-card";
import { usePrograms } from "@/hooks/use-account";
export default function BountyPage() {
  const [q, setQ] = useState("");
  const { data, isLoading } = usePrograms();

  const programs = useMemo(() => {
    let list = data?.items ?? [];
    if (q) {
      const needle = q.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(needle) || p.orgName.toLowerCase().includes(needle) || p.tags.some((t) => t.includes(needle)));
    }
    return list;
  }, [data, q]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2.5 font-display text-[28px] font-extrabold tracking-[-0.5px]">
            <Target className="h-7 w-7 text-accent" /> Bug Bounties
          </h1>
          <p className="mt-1 text-[15px] text-text-dim">Hunt vulnerabilities in live programs and earn cash bounties.</p>
        </div>
        <div className="flex gap-2.5">
          <Link href="/bounty/reports">
            <Button variant="ghost"><FileText className="h-[18px] w-[18px]" /> My reports</Button>
          </Link>
          <Link href="/settings/billing">
            <Button variant="ghost"><Wallet className="h-[18px] w-[18px]" /> Payouts</Button>
          </Link>
        </div>
      </div>

      {/* search */}
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-text-faint" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search programs…"
          className="h-11 w-full rounded-xl border border-line-strong bg-bg-elevated pl-10 pr-4 text-[14.5px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-64 w-full rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {programs.map((p) => (
            <ProgramCard key={p.id} program={p} />
          ))}
        </div>
      )}
    </div>
  );
}
