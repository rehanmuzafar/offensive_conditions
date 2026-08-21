/**
 * CTF, forum, and writeup API wrappers (ctf-svc, forum-svc, writeup-svc).
 */

import { api, ApiError } from "@/lib/api";
import type { Paginated } from "@/types";
import type {
  CtfEvent,
  CtfChallenge,
  EventRoster,
  EventWriteup,
  MyWriteup,
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

interface ApiWriteup {
  id: string;
  team_id: string | null;
  user_id: string | null;
  filename: string;
  content_type: string;
  size_bytes: number;
  status: string;
  submitted_at: string | null;
  updated_at: string | null;
}

function mapWriteup(w: ApiWriteup): EventWriteup {
  return {
    id: w.id,
    filename: w.filename,
    contentType: w.content_type,
    sizeBytes: w.size_bytes,
    status: w.status === "submitted" ? "submitted" : "draft",
    submittedAt: w.submitted_at ?? null,
    updatedAt: w.updated_at ?? null,
  };
}

/** The board plus anyone eliminated from it. */
export interface ScoreboardPage extends Paginated<ScoreboardRow> {
  eliminated: ScoreboardRow[];
}

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
  /** Long-form event copy; surfaced as "About". */
  rules_markdown?: string | null;
  id: string; slug: string; name: string; description: string | null;
  format: string; status: string; starts_at: string; ends_at: string;
  total_registered: number; total_teams: number; challenge_count: number;
  scoreboard_visibility?: "public" | "participants" | "hidden";
  is_paused?: boolean;
  pause_starts_at?: string | null;
  pause_ends_at?: string | null;
  pause_reason?: string | null;
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
    about: e.rules_markdown ?? null,
    format: (e.format === "attack_defense" ? "attack_defense" : "jeopardy") as CtfEvent["format"],
    state,
    startsAt: e.starts_at,
    endsAt: e.ends_at,
    participantCount: e.total_registered ?? 0,
    scoreboardVisibility: e.scoreboard_visibility ?? "public",
    isPaused: Boolean(e.is_paused),
    pauseStartsAt: e.pause_starts_at ?? null,
    pauseEndsAt: e.pause_ends_at ?? null,
    pauseReason: e.pause_reason ?? null,
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
  /** Where the challenge is served — the link an author enters at
   *  creation time. Was declared nowhere and mapped to null, which is why
   *  challenges showed their files but never their link. */
  connection_url?: string | null;
  delivery_type?: "static" | "shared_host" | "per_player";
  id: string; name: string; category: string; difficulty: string;
  description: string; base_points: number; current_points: number;
  total_solves: number; is_solved: boolean;
  files: { name?: string; size_bytes?: number; url?: string }[] | null;
  /* The server calls the price `point_deduction`. Reading it as `cost` meant
     every hint priced itself at "−0 pts". */
  hint_summaries:
    | { id?: string; point_deduction?: number; unlocked?: boolean; text?: string | null }[]
    | null;
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
      id: h.id ?? "",
      cost: h.point_deduction ?? 0,
      unlocked: Boolean(h.unlocked),
      text: h.text ?? null,
    })),
    connectionInfo: c.connection_url ?? null,
    deliveryType: c.delivery_type ?? (c.connection_url ? "shared_host" : "static"),
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
  /** Organiser bonuses the board is allowed to explain. */
  bonuses?: { delta: number; reason: string }[];
  pinned?: boolean;
  pinned_reason?: string | null;
}

function mapScoreboardRow(r: ApiLeaderboardEntry): ScoreboardRow {
  return {
    rank: r.rank,
    bonuses: r.bonuses ?? [],
    pinned: Boolean(r.pinned),
    pinnedReason: r.pinned_reason ?? null,
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

  /**
   * How many players each team already has entered, plus the per-team cap.
   *
   * The participants list cannot answer this — it is paginated at 100, so
   * counting there is wrong on any event of real size.
   */
  teamSlots: async (slug: string): Promise<{ maxTeamSize: number | null; counts: Record<string, number> }> => {
    const res = await api.get<{ max_team_size: number | null; counts: Record<string, number> }>(
      `/v1/ctf/events/${await eventIdFor(slug)}/team-slots`,
    );
    return { maxTeamSize: res.max_team_size ?? null, counts: res.counts ?? {} };
  },

  /** The captain's team, marked with who is entered. */
  roster: async (slug: string, teamId: string): Promise<EventRoster> => {
    const res = await api.get<{
      team_id: string;
      team_name: string;
      max_team_size: number | null;
      locked: boolean;
      members: { user_id: string; username: string | null; role: string | null; entered: boolean }[];
    }>(`/v1/ctf/events/${await eventIdFor(slug)}/roster`, { params: { team_id: teamId } });
    return {
      teamId: res.team_id,
      teamName: res.team_name,
      maxTeamSize: res.max_team_size ?? null,
      locked: Boolean(res.locked),
      members: (res.members ?? []).map((m) => ({
        userId: m.user_id,
        username: m.username ?? m.user_id.slice(0, 8),
        role: m.role ?? "member",
        entered: Boolean(m.entered),
      })),
    };
  },

  rosterAdd: async (slug: string, teamId: string, userId: string): Promise<void> => {
    await api.post<void>(`/v1/ctf/events/${await eventIdFor(slug)}/roster`, {
      body: { team_id: teamId, user_id: userId },
    });
  },

  rosterRemove: async (slug: string, teamId: string, userId: string): Promise<void> => {
    await api.delete<void>(`/v1/ctf/events/${await eventIdFor(slug)}/roster/${userId}`, {
      params: { team_id: teamId },
    });
  },

  /** The viewer's own writeup for an event, plus the deadline and the rules. */
  myWriteup: async (slug: string): Promise<MyWriteup> => {
    const res = await api.get<{
      writeup: ApiWriteup | null;
      deadline: string | null;
      required_top_n: number | null;
      allowed_extensions: string[];
    }>(`/v1/ctf/events/${await eventIdFor(slug)}/writeup`);
    return {
      writeup: res.writeup ? mapWriteup(res.writeup) : null,
      deadline: res.deadline ?? null,
      requiredTopN: res.required_top_n ?? null,
      allowedExtensions: res.allowed_extensions ?? [],
    };
  },

  /**
   * Upload or replace a draft.
   *
   * `rawBody`, not `body`: the JSON helper would stringify the FormData and set
   * `Content-Type: application/json`, which drops the file and the multipart
   * boundary with it. Left alone, the browser writes the boundary itself.
   */
  uploadWriteup: async (slug: string, file: File): Promise<void> => {
    const form = new FormData();
    form.append("file", file);
    await api.post<void>(`/v1/ctf/events/${await eventIdFor(slug)}/writeup`, { rawBody: form });
  },

  deleteWriteup: async (slug: string): Promise<void> => {
    await api.delete<void>(`/v1/ctf/events/${await eventIdFor(slug)}/writeup`);
  },

  turnInWriteup: async (slug: string): Promise<void> => {
    await api.post<void>(`/v1/ctf/events/${await eventIdFor(slug)}/writeup/turn-in`);
  },

  listChallenges: async (slug: string): Promise<CtfChallenge[]> => {
    const page = await api.get<{ items: ApiCtfChallenge[] }>(
      `/v1/ctf/events/${await eventIdFor(slug)}/challenges`,
    );
    return (page.items ?? []).map(mapCtfChallenge);
  },

  // ctf-svc calls this the leaderboard, not the scoreboard.
  scoreboard: async (slug: string): Promise<ScoreboardPage> => {
    // Without a limit the service returns its default 100, which silently cuts
    // off everyone below it — including the viewer's own team on a large board.
    const res = await api.get<{
      entries: ApiLeaderboardEntry[];
      eliminated?: ApiLeaderboardEntry[];
    }>(`/v1/ctf/events/${await eventIdFor(slug)}/leaderboard`, { params: { limit: 500 } });
    const items = (res.entries ?? []).map(mapScoreboardRow);
    return {
      items,
      /* Teams that owed a writeup and did not turn one in. Carried alongside
         rather than dropped: a result that quietly loses teams is harder to
         trust than one that shows who went. */
      eliminated: (res.eliminated ?? []).map(mapScoreboardRow),
      meta: { total: items.length, limit: items.length, offset: 0, hasMore: false },
    };
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
    api.post<{ hint_id: string; text: string; point_deduction: number }>(
      `/v1/ctf/events/${await eventIdFor(slug)}/challenges/${challengeId}/hints/${hintId}`,
    ),

  /* ---- per-team instances -----------------------------------------------
     The container belongs to the team, not to whoever pressed the button, so
     a teammate who did not spawn it still gets the address from `getInstance`.
     ---------------------------------------------------------------------- */

  getInstance: async (slug: string, challengeId: string): Promise<ChallengeInstance | null> => {
    const eventId = await eventIdFor(slug);
    const res = await api.get<RawInstance | null>(
      `/v1/ctf/events/${eventId}/challenges/${challengeId}/instance`,
    );
    return res ? mapInstance(res) : null;
  },

  spawnInstance: async (slug: string, challengeId: string): Promise<ChallengeInstance> => {
    const eventId = await eventIdFor(slug);
    return mapInstance(
      await api.post<RawInstance>(
        `/v1/ctf/events/${eventId}/challenges/${challengeId}/instance`,
      ),
    );
  },

  stopInstance: async (slug: string, challengeId: string): Promise<void> => {
    const eventId = await eventIdFor(slug);
    await api.delete(`/v1/ctf/events/${eventId}/challenges/${challengeId}/instance`);
  },
};

/** Wire shape from ctf-svc — snake_case, as every other mapper here assumes. */
interface RawInstance {
  id: string;
  challenge_id: string;
  status: string;
  host: string | null;
  port: number | null;
  connection: string | null;
  error: string | null;
  expires_at: string;
  created_at: string;
  spawned_by_name: string | null;
  created: boolean;
}

export interface ChallengeInstance {
  id: string;
  challengeId: string;
  status: "queued" | "running" | "stopped" | "error";
  host: string | null;
  port: number | null;
  connection: string | null;
  error: string | null;
  expiresAt: string;
  createdAt: string;
  spawnedByName: string | null;
  created: boolean;
}

function mapInstance(r: RawInstance): ChallengeInstance {
  return {
    id: r.id,
    challengeId: r.challenge_id,
    status: (r.status as ChallengeInstance["status"]) ?? "queued",
    host: r.host,
    port: r.port,
    connection: r.connection,
    error: r.error,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    spawnedByName: r.spawned_by_name,
    created: Boolean(r.created),
  };
}

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
