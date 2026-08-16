"use client";

import { useMemo, useState } from "react";
import { Server } from "lucide-react";

import { MachineCard } from "@/components/machines/machine-card";
import { MachineFilters } from "@/components/machines/machine-filters";
import { Skeleton } from "@/components/ui/card";
import { useMachines } from "@/hooks/use-content";
import type { MachineQuery } from "@/lib/content-api";
import type { Machine } from "@/types/content";

export default function MachinesPage() {
  const [query, setQuery] = useState<MachineQuery>({ status: "active", sort: "newest" });
  const { data, isLoading } = useMachines(query);

  function patch(p: Partial<MachineQuery>) {
    setQuery((q) => ({ ...q, ...p }));
  }

  // Client-side filtering/sorting over whatever the source returned (works for
  // both the live API page and the mock fallback).
  const machines = useMemo(() => {
    let list: Machine[] = data?.items ?? [];
    if (query.status === "active") list = list.filter((m) => m.isActive);
    if (query.status === "retired") list = list.filter((m) => !m.isActive);
    if (query.os) list = list.filter((m) => m.os === query.os);
    if (query.difficulty) list = list.filter((m) => m.difficulty === query.difficulty);
    if (query.q) {
      const q = query.q.toLowerCase();
      list = list.filter(
        (m) => m.name.toLowerCase().includes(q) || m.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }
    const sorted = [...list];
    switch (query.sort) {
      case "rating": sorted.sort((a, b) => b.rating - a.rating); break;
      case "owns": sorted.sort((a, b) => b.userOwns - a.userOwns); break;
      case "difficulty": {
        const order = { easy: 0, medium: 1, hard: 2, insane: 3 };
        sorted.sort((a, b) => order[a.difficulty] - order[b.difficulty]);
        break;
      }
      default: sorted.sort((a, b) => +new Date(b.releasedAt) - +new Date(a.releasedAt));
    }
    return sorted;
  }, [data, query]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-[28px] font-extrabold tracking-[-0.5px]">Machines</h1>
        <p className="mt-1 text-[15px] text-text-dim">
          Spin up a box, find a foothold, and root it. Submit flags to earn points.
        </p>
      </div>

      <MachineFilters query={query} onChange={patch} />

      {isLoading ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-[280px] w-full rounded-2xl" />
          ))}
        </div>
      ) : machines.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line py-20 text-center">
          <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-surface-hover text-text-faint">
            <Server className="h-7 w-7" />
          </div>
          <h3 className="font-display text-[18px] font-semibold">No machines match those filters</h3>
          <p className="mt-1 text-[14px] text-text-dim">Try clearing a filter or searching something else.</p>
        </div>
      ) : (
        <>
          <div className="text-[13.5px] text-text-faint">
            Showing <b className="text-text">{machines.length}</b> machines
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {machines.map((m) => (
              <MachineCard key={m.id} machine={m} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
