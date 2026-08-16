"use client";

import { useState, useMemo } from "react";
import { Search, Plus, MoreVertical } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, Skeleton } from "@/components/ui/card";
import { DifficultyBadge, OsIcon } from "@/components/ui/identity";
import { useAdminMachines, useSetMachineStatus } from "@/hooks/use-admin";
import { formatNumber, formatDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { AdminMachine } from "@/types/admin";

const STATUS_STYLE: Record<AdminMachine["status"], string> = {
  active: "text-success bg-success/12",
  queued: "text-info bg-info/12",
  draft: "text-text-dim bg-surface-hover",
  retired: "text-text-faint bg-surface-hover",
};

export default function AdminMachinesPage() {
  const [q, setQ] = useState("");
  const { data, isLoading } = useAdminMachines();
  const setStatus = useSetMachineStatus();
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const machines = useMemo(() => {
    let list = data?.items ?? [];
    if (q) {
      const n = q.toLowerCase();
      list = list.filter((m) => m.name.toLowerCase().includes(n) || m.maker.toLowerCase().includes(n));
    }
    return list;
  }, [data, q]);

  function action(id: string, status: string) {
    setStatus.mutate({ id, status });
    setMenuFor(null);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-[20px] font-bold">Machine management</h2>
        <Button><Plus className="h-[18px] w-[18px]" /> New machine</Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-text-faint" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search machines or makers…" className="h-10 w-full rounded-xl border border-line-strong bg-bg-elevated pl-10 pr-4 text-[14px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30" />
      </div>

      {isLoading ? (
        <Skeleton className="h-96 w-full rounded-2xl" />
      ) : (
        <Card className="overflow-visible p-0">
          <div className="grid grid-cols-[1fr_90px_80px_90px] gap-3 border-b border-line px-5 py-3 text-[12px] font-bold uppercase tracking-[1px] text-text-faint sm:grid-cols-[1fr_110px_90px_120px_90px_50px]">
            <span>Machine</span>
            <span className="hidden sm:block">Difficulty</span>
            <span>Status</span>
            <span className="hidden sm:block">Owns</span>
            <span className="hidden sm:block">Released</span>
            <span></span>
          </div>
          {machines.map((m) => (
            <div key={m.id} className="grid grid-cols-[1fr_90px_80px_90px] items-center gap-3 border-b border-line px-5 py-3.5 last:border-0 hover:bg-surface-hover sm:grid-cols-[1fr_110px_90px_120px_90px_50px]">
              <div className="flex items-center gap-3">
                <OsIcon os={m.os} className="h-4 w-4 shrink-0 text-text-faint" />
                <div className="min-w-0">
                  <div className="truncate font-display text-[14.5px] font-semibold">{m.name}</div>
                  <div className="text-[12px] text-text-faint">by {m.maker} · {m.points} pts</div>
                </div>
              </div>
              <div className="hidden sm:block"><DifficultyBadge difficulty={m.difficulty} /></div>
              <span className={cn("inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[11.5px] font-semibold capitalize", STATUS_STYLE[m.status])}>{m.status}</span>
              <span className="hidden text-[13px] text-text-dim sm:block">{formatNumber(m.userOwns)}</span>
              <span className="hidden text-[12.5px] text-text-faint sm:block">{m.releasedAt ? formatDate(m.releasedAt) : "—"}</span>
              <div className="relative flex justify-end">
                <button onClick={() => setMenuFor(menuFor === m.id ? null : m.id)} className="grid h-8 w-8 place-items-center rounded-lg text-text-faint hover:bg-surface-hover hover:text-text">
                  <MoreVertical className="h-4 w-4" />
                </button>
                {menuFor === m.id && (
                  <div className="absolute right-0 top-9 z-10 w-40 overflow-hidden rounded-xl border border-line bg-surface shadow-card-lg">
                    {m.status !== "active" && <MenuItem label="Publish (activate)" onClick={() => action(m.id, "active")} />}
                    {m.status === "active" && <MenuItem label="Retire" onClick={() => action(m.id, "retired")} />}
                    {m.status === "draft" && <MenuItem label="Queue for release" onClick={() => action(m.id, "queued")} />}
                    <MenuItem label="Edit details" onClick={() => setMenuFor(null)} />
                  </div>
                )}
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function MenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="block w-full px-3.5 py-2.5 text-left text-[13.5px] font-medium text-text-dim transition-colors hover:bg-surface-hover hover:text-text">
      {label}
    </button>
  );
}
