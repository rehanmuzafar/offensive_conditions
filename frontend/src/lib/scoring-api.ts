/**
 * Leaderboard / scoring API wrappers (scoring-svc).
 *
 * scoring-svc exposes singular `/v1/leaderboard/{global,country/:iso,season/:id}`
 * returning `{ entries, limit, offset }` where each entry is enriched server-side
 * with username/country/tier. Seasons come back as Go-serialized PascalCase. These
 * wrappers normalise both onto the camelCase frontend types. There is no dedicated
 * hall-of-fame endpoint, so it's derived from the active season + global champion.
 */

import { api } from "@/lib/api";
import type { Paginated, Tier } from "@/types";
import type {
  LeaderRow,
  LeaderboardScope,
  LeaderboardWindow,
  Season,
  HallOfFameEntry,
} from "@/types/leaderboard";

export interface LeaderboardQuery {
  scope?: LeaderboardScope;
  window?: LeaderboardWindow;
  country?: string;
  seasonId?: string;
  limit?: number;
  offset?: number;
}

/* ------------------------------ wire shapes ------------------------------- */

interface ApiEntry {
  rank: number;
  user_id: string;
  score: number | null;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  country: string | null;
  tier: string | null;
  owned_machines: number | null;
  solved_challenges: number | null;
}

interface ApiLeaderboard {
  entries: ApiEntry[];
  limit?: number;
  offset?: number;
}

interface ApiSeason {
  ID: string;
  Code: string;
  Name: string;
  StartsAt: string;
  EndsAt: string;
  State: string;
}

/* -------------------------------- helpers --------------------------------- */

const TIERS: Tier[] = [
  "noob",
  "script_kiddie",
  "hacker",
  "pro_hacker",
  "elite_hacker",
  "guru",
  "elite_operator",
];

function normalizeTier(t: string | null): Tier {
  return t && (TIERS as string[]).includes(t) ? (t as Tier) : "hacker";
}

function mapRow(e: ApiEntry): LeaderRow {
  return {
    rank: e.rank,
    userId: e.user_id,
    username: e.username ?? e.display_name ?? "unknown",
    avatarUrl: e.avatar_url ?? null,
    country: e.country ?? null,
    tier: normalizeTier(e.tier),
    points: e.score ?? 0,
    ownedMachines: e.owned_machines ?? 0,
    solvedChallenges: e.solved_challenges ?? 0,
    change: 0,
  };
}

/** "2026-Q2" → 2; otherwise the first run of digits, else 1. */
function seasonNumber(code: string): number {
  const q = code.match(/Q(\d+)/i);
  if (q) return Number(q[1]);
  const n = code.match(/(\d+)/);
  return n ? Number(n[1]) : 1;
}

function mapSeason(s: ApiSeason): Season {
  return {
    id: s.ID,
    name: s.Name,
    number: seasonNumber(s.Code),
    startsAt: s.StartsAt,
    endsAt: s.EndsAt,
    isActive: s.State === "active",
  };
}

function leaderboardPath(query: LeaderboardQuery): string {
  if (query.scope === "country" && query.country) {
    return `/v1/leaderboard/country/${query.country}`;
  }
  if (query.scope === "season" && query.seasonId) {
    return `/v1/leaderboard/season/${query.seasonId}`;
  }
  return "/v1/leaderboard/global";
}

/* ---------------------------------- api ----------------------------------- */

async function fetchLeaderboard(query: LeaderboardQuery = {}): Promise<Paginated<LeaderRow>> {
  const res = await api.get<ApiLeaderboard>(leaderboardPath(query), {
    params: { limit: query.limit, offset: query.offset },
  });
  const items = (res.entries ?? []).map(mapRow);
  return {
    items,
    meta: {
      total: items.length,
      limit: res.limit ?? items.length,
      offset: res.offset ?? 0,
      hasMore: false,
    },
  };
}

async function fetchSeasons(): Promise<Season[]> {
  const res = await api.get<{ seasons: ApiSeason[] }>("/v1/seasons");
  return (res.seasons ?? []).map(mapSeason);
}

/** No dedicated endpoint — the champion of the active season is the global #1. */
async function fetchHallOfFame(): Promise<HallOfFameEntry[]> {
  const [seasons, board] = await Promise.all([fetchSeasons(), fetchLeaderboard({ limit: 1 })]);
  const season = seasons.find((s) => s.isActive) ?? seasons[0];
  const champion = board.items[0];
  if (!season || !champion) return [];
  return [{ season, champion }];
}

export const scoringApi = {
  leaderboard: fetchLeaderboard,
  seasons: fetchSeasons,
  hallOfFame: fetchHallOfFame,
};

export type { LeaderboardScope, LeaderboardWindow };
