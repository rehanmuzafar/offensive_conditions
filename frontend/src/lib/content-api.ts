/**
 * Content / lab / dashboard API wrappers (content-svc + orchestrator).
 *
 * content-svc returns snake_case rows with backend field names (base_user_points,
 * total_user_owns, learning "paths" rather than "tracks", tags as objects). These
 * wrappers map the wire shape onto the camelCase frontend domain types so pages
 * and components stay decoupled from the backend contract.
 */

import { api } from "@/lib/api";
import type { Paginated } from "@/types";
import type { MachineDifficulty, Os } from "@/types";
import type {
  Machine,
  MachineDetail,
  Instance,
  FlagSubmitResult,
  FlagKind,
  VpnConfig,
  DashboardSummary,
  Track,
  TrackDifficulty,
  TrackDetail,
  TrackModule,
} from "@/types/content";

export interface MachineQuery {
  q?: string;
  os?: string;
  difficulty?: string;
  status?: "active" | "retired";
  sort?: "newest" | "rating" | "owns" | "difficulty";
  limit?: number;
  offset?: number;
}

/* ------------------------------ wire shapes ------------------------------- */

interface ApiTag {
  id: string;
  slug: string;
  name: string;
  color: string | null;
}

interface ApiMachine {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  os: Os;
  difficulty: string;
  base_user_points: number | null;
  base_root_points: number | null;
  total_user_owns: number | null;
  total_root_owns: number | null;
  rating_avg: number | null;
  rating_count: number | null;
  status: string;
  required_tier: string;
  released_at: string;
  retired_at: string | null;
  intro_markdown: string | null;
  tags: ApiTag[] | null;
}

interface ApiPath {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  overview_markdown: string | null;
  difficulty: string;
  estimated_hours: number | null;
  module_count: number | null;
  required_tier: string;
  released_at: string;
  modules?: ApiPathModule[] | null;
}

interface ApiPathModule {
  id: string;
  sequence: number;
  title: string;
  description: string | null;
  estimated_minutes: number | null;
  machine_id: string | null;
  challenge_id: string | null;
  is_optional: boolean | null;
}

interface ApiPage<T> {
  items: T[];
  meta: { total: number; limit: number; offset: number; has_more: boolean };
}

/* -------------------------------- helpers --------------------------------- */

const PALETTE = ["#7C3AED", "#2563EB", "#0EA5E9", "#DB2777", "#059669", "#D97706", "#DC2626", "#4F46E5"];

function colorFromSlug(slug: string): string {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length] ?? "#2563EB";
}

function normalizeMachineDifficulty(d: string): MachineDifficulty {
  switch (d) {
    case "very_easy":
    case "easy":
      return "easy";
    case "medium":
      return "medium";
    case "hard":
      return "hard";
    case "very_hard":
    case "insane":
      return "insane";
    default:
      return "medium";
  }
}

function normalizeTrackDifficulty(d: string): TrackDifficulty {
  switch (d) {
    case "beginner":
    case "intermediate":
    case "advanced":
    case "expert":
      return d;
    case "very_easy":
    case "easy":
      return "beginner";
    case "medium":
      return "intermediate";
    case "hard":
      return "advanced";
    case "insane":
    case "very_hard":
      return "expert";
    default:
      return "intermediate";
  }
}

/** Released within the last 30 days. */
function isRecent(iso: string): boolean {
  const t = Date.parse(iso);
  return Number.isFinite(t) && Date.now() - t < 30 * 24 * 60 * 60 * 1000;
}

function mapMachine(m: ApiMachine): Machine {
  return {
    id: m.id,
    slug: m.slug,
    name: m.name,
    os: m.os,
    difficulty: normalizeMachineDifficulty(m.difficulty),
    points: (m.base_user_points ?? 0) + (m.base_root_points ?? 0),
    rating: m.rating_avg ?? 0,
    ratingCount: m.rating_count ?? 0,
    userOwns: m.total_user_owns ?? 0,
    rootOwns: m.total_root_owns ?? 0,
    isActive: m.status === "active",
    isFree: m.required_tier === "free",
    releasedAt: m.released_at,
    retiresAt: m.retired_at ?? null,
    tags: (m.tags ?? []).map((t) => t.name),
    makers: [],
    thumbnailColor: m.tags?.[0]?.color ?? colorFromSlug(m.slug),
  };
}

function mapMachineDetail(m: ApiMachine): MachineDetail {
  return {
    ...mapMachine(m),
    description: m.description ?? m.intro_markdown ?? "",
    progress: {
      userFlagged: false,
      rootFlagged: false,
      userFlaggedAt: null,
      rootFlaggedAt: null,
    },
  };
}

function mapTrack(p: ApiPath): Track {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description ?? "",
    difficulty: normalizeTrackDifficulty(p.difficulty),
    moduleCount: p.module_count ?? 0,
    estimatedHours: p.estimated_hours ?? 0,
    tags: [],
    isFree: p.required_tier === "free",
    isNew: isRecent(p.released_at),
    thumbnailColor: colorFromSlug(p.slug),
    progress: null,
  };
}

function mapModule(m: ApiPathModule): TrackModule {
  const type: TrackModule["type"] = m.machine_id
    ? "lab"
    : m.challenge_id
      ? "challenge"
      : "theory";
  return {
    id: m.id,
    order: m.sequence,
    title: m.title,
    description: m.description ?? "",
    type,
    estimatedMinutes: m.estimated_minutes ?? 0,
    isLocked: false,
    completed: false,
  };
}

function mapTrackDetail(p: ApiPath): TrackDetail {
  return {
    ...mapTrack(p),
    longDescription: p.overview_markdown ?? p.description ?? "",
    skills: [],
    modules: (p.modules ?? []).map(mapModule),
  };
}

function mapPage<R, T>(p: ApiPage<R>, fn: (r: R) => T): Paginated<T> {
  return {
    items: (p.items ?? []).map(fn),
    meta: {
      total: p.meta?.total ?? 0,
      limit: p.meta?.limit ?? 0,
      offset: p.meta?.offset ?? 0,
      hasMore: p.meta?.has_more ?? false,
    },
  };
}

/* ---------------------------------- api ----------------------------------- */

export const contentApi = {
  listMachines: async (query: MachineQuery = {}): Promise<Paginated<Machine>> =>
    mapPage(await api.get<ApiPage<ApiMachine>>("/v1/machines", { params: { ...query } }), mapMachine),

  getMachine: async (slug: string): Promise<MachineDetail> =>
    mapMachineDetail(await api.get<ApiMachine>(`/v1/machines/by-slug/${slug}`)),

  /**
   * There is no /v1/me/dashboard endpoint on any service — the frontend was
   * written against a route that was never implemented, so the dashboard only
   * ever rendered its mock fallback. Compose the summary from the endpoints
   * that do exist rather than inventing numbers: scoring owns the counters,
   * user-svc owns the identity.
   *
   * activeTrack and recentActivity have no backing endpoint yet and are
   * reported as empty instead of being faked.
   */
  getDashboard: async (): Promise<DashboardSummary> => {
    const [scoreRes, meRes] = await Promise.allSettled([
      api.get<{
        total_points: number;
        machines_owned: number;
        challenges_solved: number;
        current_streak_days: number;
      }>("/v1/profile/me"),
      api.get<{ profile?: { display_name?: string; tier?: string } }>("/v1/me"),
    ]);

    const score = scoreRes.status === "fulfilled" ? scoreRes.value : null;
    const me = meRes.status === "fulfilled" ? meRes.value : null;

    // scoring exposes rank only via the leaderboard; an unranked user has none.
    let globalRank = 0;
    try {
      const board = await api.get<{ entries: { user_id: string; rank: number }[] }>(
        "/v1/leaderboard/surrounding",
      );
      globalRank = board.entries?.[0]?.rank ?? 0;
    } catch {
      globalRank = 0;
    }

    return {
      user: {
        username: me?.profile?.display_name ?? "",
        tier: (me?.profile?.tier ?? "free") as DashboardSummary["user"]["tier"],
        rank: globalRank,
        points: score?.total_points ?? 0,
        nextTier: null,
      },
      stats: {
        machinesOwned: score?.machines_owned ?? 0,
        challengesSolved: score?.challenges_solved ?? 0,
        currentStreakDays: score?.current_streak_days ?? 0,
        globalRank,
      },
      activeTrack: null,
      recentActivity: [],
    };
  },
};

export const trackApi = {
  list: async (): Promise<Paginated<Track>> =>
    mapPage(await api.get<ApiPage<ApiPath>>("/v1/paths"), mapTrack),
  get: async (slug: string): Promise<TrackDetail> =>
    mapTrackDetail(await api.get<ApiPath>(`/v1/paths/by-slug/${slug}`)),
  enroll: (slug: string) => api.post<void>(`/v1/paths/by-slug/${slug}/enroll`),
};

export const labApi = {
  // The orchestrator exposes the caller's running instances at
  // /v1/instances/active; a bare GET /v1/instances is not a route.
  listInstances: () => api.get<Instance[]>("/v1/instances/active"),

  spawn: (machineId: string) =>
    api.post<Instance>("/v1/instances", { body: { machineId } }),

  getInstance: (id: string) => api.get<Instance>(`/v1/instances/${id}`),

  stop: (id: string) => api.delete<void>(`/v1/instances/${id}`),

  extend: (id: string) => api.post<Instance>(`/v1/instances/${id}/extend`),

  reset: (id: string) => api.post<Instance>(`/v1/instances/${id}/reset`),

  submitFlag: (machineId: string, flag: string, kind: FlagKind) =>
    api.post<FlagSubmitResult>("/v1/flag/submit", {
      body: { machineId, flag, kind },
    }),

  getVpn: (region?: string) =>
    api.get<VpnConfig>("/v1/vpn/config", { params: { region } }),
};
