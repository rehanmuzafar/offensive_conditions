"use client";

/**
 * Featured — pick which items the public marketing pages show.
 *
 * Three surfaces, each an ordered list the admin curates by hand: the landing
 * machines rail, the /hacking-labs catalogue, and the /ctf-competitions
 * listing. Leaving a surface empty means its page shows everything (the
 * fallback), so this is an optional overlay, not a gate — which is exactly what
 * you want while the platform is small and becomes essential once it is not.
 *
 * Selection is search-and-click: the catalogue on the left is filtered by the
 * search box; clicking a row adds it to the ordered "Showing" list on the
 * right, where it can be reordered or removed. Save replaces the whole list for
 * that surface in one call.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Check, Plus, Search, Star, X } from "lucide-react";

import { api } from "@/lib/api";
import { featuredApi, type FeaturedSurface } from "@/lib/featured-api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";

interface Item {
  id: string;
  name: string;
  sub: string;
}

const SURFACES: { key: FeaturedSurface; itemType: string; label: string; hint: string }[] = [
  { key: "landing_machines", itemType: "machine", label: "Landing machines", hint: "The rail on the home page" },
  { key: "labs_page", itemType: "machine", label: "Labs page", hint: "The /hacking-labs catalogue" },
  { key: "ctf_page", itemType: "event", label: "CTF page", hint: "The /ctf-competitions listing" },
];

function useCatalog(itemType: string) {
  return useQuery({
    queryKey: ["featured-catalog", itemType],
    queryFn: async (): Promise<Item[]> => {
      if (itemType === "event") {
        const r = await api.get<{ items: { id: string; name: string; slug: string; status: string }[] }>(
          "/v1/ctf/events",
          { params: { limit: 200 }, anonymous: true },
        );
        return (r.items ?? []).map((e) => ({ id: e.id, name: e.name, sub: `${e.status} · ${e.slug}` }));
      }
      const r = await api.get<{ items: { id: string; name: string; slug: string; os: string; difficulty: string }[] }>(
        "/v1/machines",
        { params: { limit: 200 }, anonymous: true },
      );
      return (r.items ?? []).map((m) => ({ id: m.id, name: m.name, sub: `${m.os} · ${m.difficulty}` }));
    },
    staleTime: 60_000,
  });
}

export default function AdminFeaturedPage() {
  const [surface, setSurface] = useState<FeaturedSurface>("landing_machines");
  const active = SURFACES.find((s) => s.key === surface)!;
  const catalog = useCatalog(active.itemType);

  const [q, setQ] = useState("");
  /** The ordered ids currently chosen for this surface. */
  const [chosen, setChosen] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // Load the saved selection whenever the surface changes.
  useEffect(() => {
    let cancelled = false;
    setLoadedFor(null);
    featuredApi
      .get(surface)
      .then((r) => {
        if (!cancelled) {
          setChosen(r.items.map((i) => i.item_id));
          setLoadedFor(surface);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setChosen([]);
          setLoadedFor(surface);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [surface]);

  const byId = useMemo(() => {
    const m = new Map<string, Item>();
    for (const it of catalog.data ?? []) m.set(it.id, it);
    return m;
  }, [catalog.data]);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = catalog.data ?? [];
    return (needle ? list.filter((i) => i.name.toLowerCase().includes(needle) || i.sub.toLowerCase().includes(needle)) : list);
  }, [catalog.data, q]);

  function toggle(id: string) {
    setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  }
  function move(id: string, dir: -1 | 1) {
    setChosen((c) => {
      const i = c.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= c.length) return c;
      const next = [...c];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  }

  async function save() {
    setSaving(true);
    try {
      await featuredApi.set(surface, active.itemType, chosen);
      toast.success(`Saved — ${active.label} now shows ${chosen.length || "everything (empty = all)"}`);
    } catch {
      toast.error("Could not save. Are you signed in as staff?");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-[20px] font-bold">
            <Star className="h-5 w-5 text-accent" /> Featured
          </h2>
          <p className="mt-1 text-[13px] text-text-dim">
            Choose what the public pages show. Empty = the page shows everything.
          </p>
        </div>
        <Button onClick={save} loading={saving} disabled={loadedFor !== surface}>
          <Check className="h-4 w-4" /> Save {active.label}
        </Button>
      </div>

      {/* surface switcher */}
      <div className="flex flex-wrap gap-2">
        {SURFACES.map((s) => (
          <button
            key={s.key}
            onClick={() => setSurface(s.key)}
            className={cn(
              "border px-3.5 py-2 text-left transition-colors",
              surface === s.key
                ? "border-accent/50 bg-accent/10 text-text"
                : "border-line text-text-dim hover:border-line-strong hover:text-text",
            )}
          >
            <span className="block text-[13.5px] font-semibold">{s.label}</span>
            <span className="block text-[11px] text-text-faint">{s.hint}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* catalogue */}
        <Card interactive={false} className="p-4">
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Search ${active.itemType === "event" ? "events" : "machines"}…`}
              className="w-full border border-line bg-surface py-2.5 pl-9 pr-3 text-[14px] text-text outline-none placeholder:text-text-faint focus:border-line-strong"
            />
          </div>
          <div className="max-h-[420px] space-y-1 overflow-y-auto">
            {catalog.isLoading && <p className="py-8 text-center text-[13px] text-text-faint">Loading…</p>}
            {results.map((it) => {
              const on = chosen.includes(it.id);
              return (
                <button
                  key={it.id}
                  onClick={() => toggle(it.id)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 border px-3 py-2.5 text-left transition-colors",
                    on ? "border-accent/40 bg-accent/5" : "border-line hover:border-line-strong hover:bg-surface-hover",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] text-text">{it.name}</span>
                    <span className="block truncate text-[11.5px] text-text-faint">{it.sub}</span>
                  </span>
                  {on ? <Check className="h-4 w-4 shrink-0 text-accent" /> : <Plus className="h-4 w-4 shrink-0 text-text-faint" />}
                </button>
              );
            })}
            {!catalog.isLoading && results.length === 0 && (
              <p className="py-8 text-center text-[13px] text-text-faint">Nothing matches.</p>
            )}
          </div>
        </Card>

        {/* chosen, in order */}
        <Card interactive={false} className="p-4">
          <p className="mb-3 flex items-center justify-between text-[13px] font-semibold text-text">
            Showing, in order
            <span className="text-[11.5px] font-normal text-text-faint">
              {chosen.length === 0 ? "empty → page shows all" : `${chosen.length} selected`}
            </span>
          </p>
          <div className="max-h-[460px] space-y-1 overflow-y-auto">
            {chosen.map((id, i) => {
              const it = byId.get(id);
              return (
                <div key={id} className="flex items-center gap-2 border border-line px-3 py-2.5">
                  <span className="w-6 shrink-0 text-center font-mono text-[12px] text-text-faint">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] text-text">{it?.name ?? id}</span>
                    {it && <span className="block truncate text-[11.5px] text-text-faint">{it.sub}</span>}
                  </span>
                  <button onClick={() => move(id, -1)} disabled={i === 0} className="grid h-7 w-7 place-items-center border border-line text-text-faint disabled:opacity-30 hover:text-text" aria-label="Move up">
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => move(id, 1)} disabled={i === chosen.length - 1} className="grid h-7 w-7 place-items-center border border-line text-text-faint disabled:opacity-30 hover:text-text" aria-label="Move down">
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => toggle(id)} className="grid h-7 w-7 place-items-center border border-line text-text-faint hover:border-danger/50 hover:text-danger" aria-label="Remove">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
            {chosen.length === 0 && (
              <p className="py-10 text-center text-[13px] text-text-faint">
                Nothing chosen — the page will show everything. Click items on the left to feature them.
              </p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
