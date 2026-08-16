/**
 * CTF, forum, and writeup API wrappers (ctf-svc, forum-svc, writeup-svc).
 */

import { api, ApiError } from "@/lib/api";
import type { Paginated } from "@/types";
import type {
  CtfEvent,
  CtfChallenge,
  ScoreboardRow,
  ChallengeSolveResult,
} from "@/types/ctf";
import type {
  ForumCategory,
  ForumThread,
  ForumPost,
  Writeup,
  WriteupDetail,
} from "@/types/forum";

/* ----------------------------- ctf mappers ------------------------------ */
/**
 * ctf-svc speaks snake_case and exposes a six-state lifecycle
 * (draft|published|registration|live|ended|archived) keyed by event id, while
 * the UI models a three-state pill keyed by slug. Nothing mapped these before —
 * the calls were unchecked generic casts, so `event.state` came back undefined
 * and the events page crashed on `map[undefined].cls` as soon as a real event
 * existed. The mock fallback hid it until now.
 */
interface ApiCtfEvent {
  id: string; slug: string; name: string; description: string | null;
  format: string; status: string; starts_at: string; ends_at: string;
  total_registered: number; total_teams: number; challenge_count: number;
  team_play: boolean; solo_play: boolean; max_team_size: number | null;
  prize_pool: { place?: string; prize?: string }[] | null;
  cover_image_url: string | null;
}

function mapCtfEvent(e: ApiCtfEvent, challengeCount?: number, isRegistered = false): CtfEvent {
  const state: CtfEvent["state"] =
    e.status === "live" ? "live"
    : e.status === "ended" || e.status === "archived" ? "ended"
    : "upcoming";
  return {
    id: e.id,
    slug: e.slug,
    name: e.name,
    description: e.description ?? "",
    format: (e.format === "attack_defense" ? "attack_defense" : "jeopardy") as CtfEvent["format"],
    state,
    startsAt: e.starts_at,
    endsAt: e.ends_at,
    participantCount: e.total_registered ?? 0,
    teamCount: e.total_teams ?? 0,
    challengeCount: challengeCount ?? e.challenge_count ?? 0,
    prizePool: e.prize_pool?.length
      ? e.prize_pool.map((p) => p.prize).filter(Boolean).join(", ")
      : null,
    // bannerColor feeds a CSS gradient; the uploaded image is a separate field.
    bannerColor: "#7C3AED",
    bannerImageUrl: e.cover_image_url ?? null,
    // The three-state pill cannot express draft vs published; keep the real
    // lifecycle status so organiser views can show it.
    status: e.status,
    teamPlay: Boolean(e.team_play),
    soloPlay: Boolean(e.solo_play),
    maxTeamSize: e.max_team_size ?? null,
    isRegistered,
  };
}

interface ApiCtfChallenge {
  id: string; name: string; category: string; difficulty: string;
  description: string; base_points: number; current_points: number;
  total_solves: number; is_solved: boolean;
  files: { name?: string; size_bytes?: number; url?: string }[] | null;
  hint_summaries: { id?: string; cost?: number; unlocked?: boolean; text?: string | null }[] | null;
  first_blood_user_id: string | null; first_blood_at: string | null;
}

function mapCtfChallenge(c: ApiCtfChallenge): CtfChallenge {
  return {
    id: c.id,
    title: c.name,
    category: c.category as CtfChallenge["category"],
    points: c.current_points ?? c.base_points,
    basePoints: c.base_points ?? c.current_points ?? 0,
    difficulty: c.difficulty as CtfChallenge["difficulty"],
    description: c.description,
    solveCount: c.total_solves ?? 0,
    solved: Boolean(c.is_solved),
    files: (c.files ?? []).map((f) => ({
      name: f.name ?? "", sizeBytes: f.size_bytes ?? 0, url: f.url ?? "",
    })),
    hints: (c.hint_summaries ?? []).map((h) => ({
      id: h.id ?? "", cost: h.cost ?? 0, unlocked: Boolean(h.unlocked), text: h.text ?? null,
    })),
    connectionInfo: null,
    firstBlood: c.first_blood_user_id && c.first_blood_at
      ? { username: c.first_blood_user_id, at: c.first_blood_at }
      : null,
  };
}

interface ApiLeaderboardEntry {
  rank: number; participant_id: string; team_id: string | null; display_name: string;
  points: number; solve_count: number; last_solve_at: string | null;
  country_code: string | null;
  first_bloods: number;
}

function mapScoreboardRow(r: ApiLeaderboardEntry): ScoreboardRow {
  return {
    rank: r.rank,
    // The team id, not the participant id — the own-row highlight compares
    // against the viewer's team and silently never matched before.
    teamId: r.team_id ?? r.participant_id,
    teamName: r.display_name,
    country: r.country_code,
    countryCode: r.country_code,
    firstBloods: r.first_bloods ?? 0,
    points: r.points,
    solveCount: r.solve_count ?? 0,
    lastSolveAt: r.last_solve_at,
    change: 0,
  };
}

/** ctf-svc keys everything by event id; the UI routes by slug. */
async function eventIdFor(slug: string): Promise<string> {
  const e = await api.get<ApiCtfEvent>(`/v1/ctf/events/by-slug/${slug}`);
  return e.id;
}

/** The viewer's own standing in one event. */
export interface MyParticipation {
  id: string;
  team_id: string | null;
  points: number;
  solve_count: number;
  rank: number | null;
  team_name_at_event: string | null;
}

export const ctfApi = {
  listEvents: async (state?: string): Promise<Paginated<CtfEvent>> => {
    const page = await api.get<{
      items: ApiCtfEvent[];
      meta: { total: number; limit: number; offset: number; has_more: boolean };
    }>("/v1/ctf/events", { params: { status: state } });
    return {
      items: (page.items ?? []).map((e) => mapCtfEvent(e)),
      meta: {
        total: page.meta?.total ?? 0,
        limit: page.meta?.limit ?? 0,
        offset: page.meta?.offset ?? 0,
        hasMore: Boolean(page.meta?.has_more),
      },
    };
  },

  getEvent: async (slug: string): Promise<CtfEvent> => {
    const e = await api.get<ApiCtfEvent>(`/v1/ctf/events/by-slug/${slug}`);
    // The event payload says nothing about the viewer. On a team event the
    // participant row is keyed by team, so "am I in?" can only be answered by
    // asking — a member who never clicked anything is still registered.
    let registered = false;
    try {
      const p = await api.get<{ id?: string } | null>(
        `/v1/ctf/events/${e.id}/my-participation`,
      );
      registered = Boolean(p && p.id);
    } catch {
      registered = false;
    }
    return mapCtfEvent(e, undefined, registered);
  },

  /** The viewer's own standing in an event: rank, points, flags. */
  myParticipation: (eventId: string) =>
    api.get<MyParticipation | null>(`/v1/ctf/events/${eventId}/my-participation`),

  /**
   * Register the caller. On a team event they must name which of their teams
   * they are playing for; teammates each register themselves against the same
   * team. The service verifies the caller really belongs to it.
   */
  register: async (slug: string, teamId?: string): Promise<void> => {
    await api.post<void>(`/v1/ctf/events/${await eventIdFor(slug)}/register`, {
      body: teamId ? { team_id: teamId } : {},
    });
  },

  listChallenges: async (slug: string): Promise<CtfChallenge[]> => {
    const page = await api.get<{ items: ApiCtfChallenge[] }>(
      `/v1/ctf/events/${await eventIdFor(slug)}/challenges`,
    );
    return (page.items ?? []).map(mapCtfChallenge);
  },

  // ctf-svc calls this the leaderboard, not the scoreboard.
  scoreboard: async (slug: string): Promise<Paginated<ScoreboardRow>> => {
    // Without a limit the service returns its default 100, which silently cuts
    // off everyone below it — including the viewer's own team on a large board.
    const res = await api.get<{ entries: ApiLeaderboardEntry[] }>(
      `/v1/ctf/events/${await eventIdFor(slug)}/leaderboard`,
      { params: { limit: 500 } },
    );
    const items = (res.entries ?? []).map(mapScoreboardRow);
    return { items, meta: { total: items.length, limit: items.length, offset: 0, hasMore: false } };
  },

  /**
   * ctf-svc returns {accepted, points_awarded, is_first_blood} and answers a
   * wrong flag with 422 FLAG_INCORRECT / a repeat with 409 ALREADY_SOLVED.
   * Nothing mapped this, so `res.correct` was always undefined and even a
   * correct flag reported "Incorrect flag".
   */
  submitFlag: async (
    slug: string,
    challengeId: string,
    flag: string,
  ): Promise<ChallengeSolveResult> => {
    const eventId = await eventIdFor(slug);
    try {
      const res = await api.post<{
        accepted: boolean;
        points_awarded: number;
        is_first_blood: boolean;
      }>(`/v1/ctf/events/${eventId}/challenges/${challengeId}/submit`, { body: { flag } });
      return {
        correct: Boolean(res.accepted),
        pointsAwarded: res.points_awarded ?? 0,
        firstBlood: Boolean(res.is_first_blood),
        alreadySolved: false,
      };
    } catch (err) {
      if (err instanceof ApiError && err.code === "FLAG_INCORRECT") {
        return { correct: false, pointsAwarded: 0, firstBlood: false, alreadySolved: false };
      }
      if (err instanceof ApiError && err.code === "ALREADY_SOLVED") {
        return { correct: true, pointsAwarded: 0, firstBlood: false, alreadySolved: true };
      }
      throw err;
    }
  },

  unlockHint: async (slug: string, challengeId: string, hintId: string) =>
    api.post<{ text: string }>(
      `/v1/ctf/events/${await eventIdFor(slug)}/challenges/${challengeId}/hints/${hintId}`,
    ),
};

export interface ThreadQuery {
  category?: string;
  q?: string;
  sort?: "latest" | "top" | "unanswered";
  limit?: number;
  offset?: number;
}

export const forumApi = {
  categories: () => api.get<ForumCategory[]>("/v1/forum/categories"),
  listThreads: (query: ThreadQuery = {}) =>
    api.get<Paginated<ForumThread>>("/v1/forum/threads", { params: { ...query } }),
  getThread: (id: string) => api.get<ForumThread>(`/v1/forum/threads/${id}`),
  listPosts: (threadId: string) =>
    api.get<ForumPost[]>(`/v1/forum/threads/${threadId}/posts`),
  createThread: (body: { title: string; categorySlug: string; bodyMd: string; tags: string[] }) =>
    api.post<ForumThread>("/v1/forum/threads", { body }),
  reply: (threadId: string, bodyMd: string) =>
    api.post<ForumPost>(`/v1/forum/threads/${threadId}/posts`, { body: { bodyMd } }),
  vote: (postId: string, value: 1 | 0 | -1) =>
    api.post<void>(`/v1/forum/posts/${postId}/vote`, { body: { value } }),
};

export interface WriteupQuery {
  q?: string;
  target?: string;
  sort?: "latest" | "top";
  limit?: number;
  offset?: number;
}

export const writeupApi = {
  list: (query: WriteupQuery = {}) =>
    api.get<Paginated<Writeup>>("/v1/writeups", { params: { ...query } }),
  get: (slug: string) => api.get<WriteupDetail>(`/v1/writeups/${slug}`),
  publish: (body: { title: string; targetSlug: string; bodyMd: string; tags: string[] }) =>
    api.post<WriteupDetail>("/v1/writeups", { body }),
  vote: (id: string, value: 1 | 0 | -1) =>
    api.post<void>(`/v1/writeups/${id}/vote`, { body: { value } }),
};
