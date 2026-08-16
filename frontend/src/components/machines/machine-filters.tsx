"use client";

import { Search } from "lucide-react";

import { cn } from "@/lib/cn";
import type { MachineQuery } from "@/lib/content-api";

const OS_OPTS = [
  { value: "", label: "All OS" },
  { value: "linux", label: "Linux" },
  { value: "windows", label: "Windows" },
];
const DIFF_OPTS = [
  { value: "", label: "All" },
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
  { value: "insane", label: "Insane" },
];
const STATUS_OPTS = [
  { value: "active", label: "Active" },
  { value: "retired", label: "Retired" },
];
const SORT_OPTS = [
  { value: "newest", label: "Newest" },
  { value: "rating", label: "Top rated" },
  { value: "owns", label: "Most owned" },
  { value: "difficulty", label: "Difficulty" },
];

export function MachineFilters({
  query,
  onChange,
}: {
  query: MachineQuery;
  onChange: (patch: Partial<MachineQuery>) => void;
}) {
  return (
    <div className="space-y-4">
      {/* search */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-text-faint" />
        <input
          value={query.q ?? ""}
          onChange={(e) => onChange({ q: e.target.value })}
          placeholder="Search machines by name or tag…"
          className="h-11 w-full rounded-xl border border-line-strong bg-bg-elevated pl-10 pr-4 text-[14.5px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
      </div>

      {/* filter rows */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <Segment label="OS" options={OS_OPTS} value={query.os ?? ""} onSelect={(v) => onChange({ os: v || undefined })} />
        <Segment label="Difficulty" options={DIFF_OPTS} value={query.difficulty ?? ""} onSelect={(v) => onChange({ difficulty: v || undefined })} />
        <Segment label="Status" options={STATUS_OPTS} value={query.status ?? "active"} onSelect={(v) => onChange({ status: v as MachineQuery["status"] })} />

        <div className="ml-auto flex items-center gap-2">
          <span className="text-[13px] text-text-faint">Sort</span>
          <select
            value={query.sort ?? "newest"}
            onChange={(e) => onChange({ sort: e.target.value as MachineQuery["sort"] })}
            className="h-9 rounded-lg border border-line-strong bg-bg-elevated px-3 text-[13.5px] font-medium text-text focus:border-accent focus:outline-none"
          >
            {SORT_OPTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

function Segment({
  label,
  options,
  value,
  onSelect,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onSelect: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[13px] text-text-faint">{label}</span>
      <div className="flex rounded-lg border border-line-strong p-0.5">
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => onSelect(o.value)}
            className={cn(
              "rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors",
              value === o.value ? "bg-brand-gradient text-white" : "text-text-dim hover:text-text",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
