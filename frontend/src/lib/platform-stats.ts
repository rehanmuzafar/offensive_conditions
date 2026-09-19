"use client";

/**
 * Real platform counts, from the public API — the single source the marketing
 * surfaces read instead of hardcoding figures.
 *
 * Every number a visitor sees about the size of the platform used to be typed
 * into the component that showed it (128K operators, 540+ machines, 195
 * countries, and so on), none of it true. This replaces all of that with the
 * actual totals, so the pages can never again claim more than exists. The
 * endpoints are the same public ones the catalogue and leaderboard use, so the
 * request is anonymous and shared (react-query dedupes by key across every
 * section that calls this on a page).
 *
 * The numbers are what they are. On a young platform they are small, and the
 * pages will read as small — which is the correct, honest state, and the point
 * of the change.
 */

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { scoringApi } from "@/lib/scoring-api";

async function total(path: string): Promise<number> {
  try {
    const r = await api.get<{ meta?: { total?: number } }>(path, {
      params: { limit: 1 },
      anonymous: true,
    });
    return r.meta?.total ?? 0;
  } catch {
    return 0;
  }
}

export interface PlatformStats {
  machines: number;
  challenges: number;
  paths: number;
  events: number;
  liveEvents: number;
  operators: number;
  countries: number;
  /** true until the first real numbers land, so callers can show a placeholder. */
  loading: boolean;
}

export function usePlatformStats(): PlatformStats {
  const { data } = useQuery({
    queryKey: ["platform-stats"],
    queryFn: async () => {
      const [machines, challenges, paths, events, board] = await Promise.all([
        total("/v1/machines"),
        total("/v1/challenges"),
        total("/v1/paths"),
        api
          .get<{ items?: { status?: string }[]; meta?: { total?: number } }>("/v1/ctf/events", {
            params: { limit: 100 },
            anonymous: true,
          })
          .catch(() => ({ items: [] as { status?: string }[], meta: { total: 0 } })),
        scoringApi
          .leaderboard({ scope: "global", limit: 200 })
          .catch(() => ({ items: [] as { country: string | null }[] })),
      ]);
      const evItems = events.items ?? [];
      const boardItems = (board.items ?? []) as { country: string | null }[];
      return {
        machines,
        challenges,
        paths,
        events: events.meta?.total ?? evItems.length,
        liveEvents: evItems.filter((e) => e.status === "live").length,
        operators: boardItems.length,
        countries: new Set(boardItems.map((r) => r.country).filter(Boolean)).size,
      };
    },
    staleTime: 60_000,
  });

  return {
    machines: data?.machines ?? 0,
    challenges: data?.challenges ?? 0,
    paths: data?.paths ?? 0,
    events: data?.events ?? 0,
    liveEvents: data?.liveEvents ?? 0,
    operators: data?.operators ?? 0,
    countries: data?.countries ?? 0,
    loading: !data,
  };
}
