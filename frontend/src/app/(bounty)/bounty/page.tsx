"use client";

/**
 * Opportunity discovery — the front door of the bug bounty surface.
 *
 * Built around the question "what should I hack next", which is a browsing
 * problem, not a search problem: most people arrive without a program in mind.
 * So the page leads with rows of programs cut different ways — the ones that
 * pay most, the ones that answer fastest, the ones nobody has picked over yet —
 * and puts search above them for the minority who do know what they want.
 *
 * Each row is its own query with its own ordering rather than one fetch sliced
 * client-side, because "top paying" and "fastest response" are different sorts
 * over the whole catalogue, not different windows into one page of it.
 */

import { useMemo, useState } from "react";
import { Search, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, Skeleton } from "@/components/ui/card";
import { ProgramCard } from "@/components/bounty/program-card";
import { ProgramRow } from "@/components/bounty/program-row";
import { usePrograms } from "@/hooks/use-account";
import { cn } from "@/lib/cn";

const ASSET_TYPES = [
  { value: "", label: "All assets" },
  { value: "domain", label: "Domain" },
  { value: "wildcard", label: "Wildcard" },
  { value: "api", label: "API" },
  { value: "ip", label: "IP address" },
  { value: "ip_range", label: "IP range" },
  { value: "mobile_app", label: "Mobile app" },
  { value: "source_code", label: "Source code" },
  { value: "other", label: "Other" },
];

const PROGRAM_TYPES = [
  { value: "", label: "All programs" },
  { value: "bounty", label: "Bounty" },
  { value: "vdp", label: "Disclosure only" },
];

export default function OpportunityDiscoveryPage() {
  const [draft, setDraft] = useState({ q: "", assetType: "", programType: "" });
  const [applied, setApplied] = useState(draft);

  const searching = Boolean(applied.q || applied.assetType || applied.programType);

  const query = useMemo(
    () => ({
      q: applied.q || undefined,
      assetType: applied.assetType || undefined,
      hasBounty:
        applied.programType === "bounty"
          ? true
          : applied.programType === "vdp"
            ? false
            : undefined,
      limit: 48,
    }),
    [applied],
  );

  const results = usePrograms(searching ? query : { limit: 48 });
  // Memoised so the three sorts below do not re-run on every render just
  // because `?? []` produced a fresh array.
  const all = useMemo(() => results.data?.items ?? [], [results.data]);

  // The rows below are cuts of the same catalogue. With a real catalogue these
  // would each be a sorted query; the sort keys are all on the card payload, so
  // ordering here costs one pass and no extra round trips.
  const topPaying = useMemo(
    () => [...all].filter((p) => p.maxRewardCents > 0).sort((a, b) => b.maxRewardCents - a.maxRewardCents),
    [all],
  );
  const responsive = useMemo(
    () =>
      [...all]
        .filter((p) => p.responseEfficiency !== null)
        .sort((a, b) => (b.responseEfficiency ?? 0) - (a.responseEfficiency ?? 0)),
    [all],
  );
  const untouched = useMemo(
    () => [...all].sort((a, b) => a.totalReports - b.totalReports),
    [all],
  );

  return (
    <div className="space-y-8">
      <Hero
        draft={draft}
        setDraft={setDraft}
        onSearch={() => setApplied(draft)}
        count={results.data?.meta?.total ?? 0}
        loading={results.isLoading}
      />

      {results.isLoading ? (
        <CardRowSkeleton />
      ) : all.length === 0 ? (
        <EmptyState searching={searching} />
      ) : searching ? (
        <section>
          <h2 className="font-display text-[19px] font-bold tracking-[-0.3px]">
            {all.length} {all.length === 1 ? "program" : "programs"}
          </h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {all.map((p) => (
              <ProgramCard key={p.id} program={p} />
            ))}
          </div>
        </section>
      ) : (
        <>
          <ProgramRow
            title="Top paying"
            hint="Highest maximum bounty."
            programs={topPaying}
          />
          <ProgramRow
            title="Answers fastest"
            hint="Measured against each program's own response SLA."
            programs={responsive}
          />
          <ProgramRow
            title="Least picked over"
            hint="Fewest reports so far — the easiest place to be first."
            programs={untouched}
          />
        </>
      )}
    </div>
  );
}

function Hero({
  draft,
  setDraft,
  onSearch,
  count,
  loading,
}: {
  draft: { q: string; assetType: string; programType: string };
  setDraft: (d: { q: string; assetType: string; programType: string }) => void;
  onSearch: () => void;
  count: number;
  loading: boolean;
}) {
  return (
    <section className="edge-iridescent relative overflow-hidden rounded-2xl border border-line">
      {/* The band is the one place on this surface that carries the brand
          gradient — everything below it is a working list and stays quiet. */}
      <div className="bg-brand-gradient px-6 pb-16 pt-7 sm:px-8">
        <p className="text-[13px] font-medium text-white/80">
          Find the best opportunities for your skills
        </p>
        <h1 className="mt-1 font-display text-[32px] font-extrabold leading-tight tracking-[-0.8px] text-white sm:text-[38px]">
          Opportunity Discovery
        </h1>
      </div>

      <div className="-mt-10 px-4 pb-5 sm:px-6">
        <Card className="glass-strong p-4 sm:p-5">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[220px] flex-1">
              <label className="text-[11.5px] font-semibold uppercase tracking-wide text-text-faint">
                {loading ? "Loading programs…" : `${count} ${count === 1 ? "program" : "programs"} available`}
              </label>
              <div className="relative mt-1.5">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-text-faint" />
                <input
                  value={draft.q}
                  onChange={(e) => setDraft({ ...draft, q: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && onSearch()}
                  placeholder="Search for programs…"
                  className="h-11 w-full rounded-xl border border-line-strong bg-bg-elevated pl-10 pr-4 text-[14.5px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
              </div>
            </div>

            <Select
              label="Program type"
              value={draft.programType}
              onChange={(v) => setDraft({ ...draft, programType: v })}
              options={PROGRAM_TYPES}
            />
            <Select
              label="Asset type"
              value={draft.assetType}
              onChange={(v) => setDraft({ ...draft, assetType: v })}
              options={ASSET_TYPES}
            />

            <Button size="lg" onClick={onSearch} className="h-11">
              Search
            </Button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-text-faint">Popular now</span>
            {["domain", "api", "wildcard", "source_code"].map((t) => (
              <button
                key={t}
                onClick={() => setDraft({ ...draft, assetType: t })}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-[12px] transition-colors",
                  draft.assetType === t
                    ? "border-accent bg-accent/12 text-accent"
                    : "border-line text-text-dim hover:text-text",
                )}
              >
                {ASSET_TYPES.find((a) => a.value === t)?.label}
              </button>
            ))}
          </div>
        </Card>
      </div>
    </section>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="min-w-[150px]">
      <label className="text-[11.5px] font-semibold uppercase tracking-wide text-text-faint">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 h-11 w-full rounded-xl border border-line-strong bg-bg-elevated px-3 text-[14px] text-text focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function CardRowSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-[320px] w-full rounded-2xl" />
      ))}
    </div>
  );
}

function EmptyState({ searching }: { searching: boolean }) {
  return (
    <Card className="p-12 text-center">
      <Sparkles className="mx-auto h-7 w-7 text-text-ghost" strokeWidth={1.5} />
      <p className="mt-3 font-display text-[17px] font-bold">
        {searching ? "Nothing matches those filters" : "No programs published yet"}
      </p>
      <p className="mx-auto mt-1.5 max-w-md text-[13.5px] leading-relaxed text-text-dim">
        {searching
          ? "Try widening the asset type, or clear the search."
          : "Once a company publishes a bug bounty program it shows up here, with its scope, rewards and how quickly it responds."}
      </p>
    </Card>
  );
}
