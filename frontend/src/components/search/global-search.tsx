"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Flag, Loader2, Search, Server } from "lucide-react";

import { Avatar } from "@/components/ui/identity";
import { cn } from "@/lib/cn";
import { ctfApi } from "@/lib/community-api";
import { contentApi } from "@/lib/content-api";
import { teamsApi, searchUsers } from "@/lib/teams-api";

interface Hit {
  kind: "machine" | "player" | "team" | "event";
  id: string;
  label: string;
  sub?: string;
  href: string;
}

/**
 * The topbar search.
 *
 * It was an `<input>` carrying a placeholder and nothing else — no state, no
 * handler, no request — so typing in it did nothing at all.
 *
 * There is no single search endpoint on the platform, so this fans out to the
 * listings that already take a query and merges the answers. Each source is its
 * own query on purpose: a slow service should hold up its own group rather than
 * the whole dropdown, and one that is down costs the user a section instead of
 * the feature.
 */
export function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const term = useDebounced(q.trim(), 220);
  const enabled = term.length >= 2;

  const machines = useQuery({
    queryKey: ["search", "machines", term],
    queryFn: () => contentApi.listMachines({ q: term, limit: 4 }),
    enabled,
    staleTime: 30_000,
  });
  const players = useQuery({
    queryKey: ["search", "players", term],
    queryFn: () => searchUsers(term, 4),
    enabled,
    staleTime: 30_000,
  });
  const teams = useQuery({
    queryKey: ["search", "teams", term],
    queryFn: () => teamsApi.browse({ q: term }),
    enabled,
    staleTime: 30_000,
  });
  /* ctf-svc takes no query parameter on its event list, so events are filtered
     here. They are counted in tens, not thousands. */
  const events = useQuery({
    queryKey: ["search", "events"],
    queryFn: () => ctfApi.listEvents(),
    enabled,
    staleTime: 60_000,
  });

  const results = useMemo<Hit[]>(() => {
    if (!enabled) return [];
    const needle = term.toLowerCase();
    return [
      ...(machines.data?.items ?? []).slice(0, 4).map(
        (m): Hit => ({ kind: "machine", id: m.id, label: m.name, sub: m.os, href: `/machines/${m.slug}` }),
      ),
      ...(players.data ?? []).slice(0, 4).map(
        (u): Hit => ({
          kind: "player",
          id: u.user_id,
          label: u.username,
          sub: u.display_name || undefined,
          href: `/u/${u.username}`,
        }),
      ),
      ...(teams.data ?? []).slice(0, 4).map(
        (t): Hit => ({
          kind: "team",
          id: t.id,
          label: t.name,
          sub: `${t.member_count} member${t.member_count === 1 ? "" : "s"}`,
          href: `/teams/${t.slug || t.id}`,
        }),
      ),
      ...(events.data?.items ?? [])
        .filter((e) => e.name.toLowerCase().includes(needle))
        .slice(0, 4)
        .map((e): Hit => ({ kind: "event", id: e.id, label: e.name, sub: e.state, href: `/ctf/${e.slug}` })),
    ];
  }, [enabled, term, machines.data, players.data, teams.data, events.data]);

  const loading =
    enabled && (machines.isFetching || players.isFetching || teams.isFetching || events.isFetching);

  // Close on an outside click, the way the user menu beside it does.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  useEffect(() => setActive(0), [term]);

  function go(hit: Hit | undefined) {
    if (!hit) return;
    setOpen(false);
    setQ("");
    router.push(hit.href);
  }

  return (
    <div ref={boxRef} className="relative hidden max-w-md flex-1 sm:block">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-text-faint" />
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            go(results[active]);
          }
        }}
        placeholder="Search machines, teams, players, events…"
        className="h-9 w-full border border-line bg-transparent pl-10 pr-9 text-[12.5px] text-text placeholder:text-text-ghost focus:border-text focus:outline-none"
      />
      {loading && (
        <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-text-faint" />
      )}

      {open && enabled && (
        <div className="glass-strong absolute left-0 right-0 top-11 z-50 max-h-[70vh] overflow-y-auto">
          {results.length === 0 && !loading && (
            <p className="px-4 py-6 text-center text-[12.5px] text-text-faint">
              Nothing matches “{term}”.
            </p>
          )}
          {results.map((hit, i) => (
            <button
              key={`${hit.kind}-${hit.id}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(hit)}
              className={cn(
                "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors",
                i === active ? "bg-surface-hover" : "hover:bg-surface-hover",
              )}
            >
              <HitIcon hit={hit} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-text">{hit.label}</span>
                {hit.sub && (
                  <span className="block truncate text-[11px] capitalize text-text-faint">{hit.sub}</span>
                )}
              </span>
              <span className="shrink-0 text-[10px] uppercase tracking-wide text-text-ghost">
                {hit.kind}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function HitIcon({ hit }: { hit: Hit }) {
  if (hit.kind === "player" || hit.kind === "team") {
    return <Avatar username={hit.label} size="sm" />;
  }
  const Icon = hit.kind === "machine" ? Server : Flag;
  return (
    <span className="grid h-7 w-7 shrink-0 place-items-center border border-line text-text-faint">
      <Icon className="h-3.5 w-3.5" />
    </span>
  );
}

/** Debounce, so a fast typist fires one round of requests rather than ten. */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
