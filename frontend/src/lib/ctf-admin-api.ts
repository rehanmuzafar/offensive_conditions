/**
 * Admin-side CTF management (ctf-svc) + banner uploads (content-svc).
 *
 * The public `ctfApi` in community-api.ts is read-mostly and keyed by slug for
 * the player-facing pages. Organiser actions are keyed by event id and use the
 * service's own snake_case payloads, so they live here rather than being bolted
 * onto the player API.
 */

import { api } from "@/lib/api";

/* ------------------------------- events --------------------------------- */

export type CtfEventFormat = "jeopardy" | "attack_defense" | "hybrid" | "king_of_hill";
export type CtfEventVisibility = "public" | "private" | "invite_only";
export type CtfRequiredTier = "free" | "vip" | "vip_plus";

/** Where per-player spawns are provisioned. Static and shared-host challenges
 *  work regardless of this. */
export type ChallengeRuntime = "cloud" | "onsite" | "static_only";

/** How a challenge reaches the player. Independent of its attachments. */
export type DeliveryType = "static" | "shared_host" | "per_player";

export interface ChallengeFile {
  name: string;
  url: string;
  size_bytes: number;
  sha256: string;
}

/** ctf-svc lifecycle — richer than the three-state pill the player UI shows. */
export type CtfEventStatus =
  | "draft"
  | "published"
  | "registration"
  | "live"
  | "ended"
  | "archived";

export interface AdminCtfEntry {
  team_id: string | null;
  user_id: string | null;
  name: string;
  is_team: boolean;
  member_count: number;
  /** Points from solves alone. */
  earned_points: number;
  /** Net of every organiser adjustment; may be negative. */
  adjustment: number;
  /** earned_points + adjustment — what the scoreboard shows. */
  points: number;
  solve_count: number;
  banned: boolean;
  ban_reason: string | null;
  /** Set by hand; null means this row sits where its points put it. */
  pinned_position: number | null;
  pinned_reason: string | null;
}

export interface AdminCtfAdjustment {
  id: string;
  team_id: string | null;
  user_id: string | null;
  delta: number;
  reason: string | null;
  visible: boolean;
  actor_id: string;
  created_at: string | null;
}

export interface AdminCtfWriteup {
  id: string;
  team_id: string | null;
  user_id: string | null;
  filename: string;
  content_type: string;
  size_bytes: number;
  status: "draft" | "submitted";
  submitted_at: string | null;
  updated_at: string | null;
  /** Where the team finished — the organiser reads the writeup against it. */
  standing: {
    rank: number;
    display_name: string;
    points: number;
    first_bloods: number;
    solve_count: number;
  } | null;
}

export interface AdminCtfEvent {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  overview_markdown: string | null;
  format: CtfEventFormat;
  visibility: CtfEventVisibility;
  status: CtfEventStatus;
  team_play: boolean;
  solo_play: boolean;
  max_team_size: number | null;
  registration_starts_at: string;
  registration_ends_at: string;
  starts_at: string;
  ends_at: string;
  scoreboard_freeze_at: string | null;
  /* Pause is not a status: the event stays live while stopped. */
  writeup_required_top_n?: number | null;
  writeup_deadline?: string | null;
  is_paused?: boolean;
  pause_starts_at?: string | null;
  pause_ends_at?: string | null;
  pause_reason?: string | null;
  dynamic_scoring: boolean;
  min_points: number;
  first_blood_bonus: number;
  required_tier: CtfRequiredTier;
  entry_fee_cents: number;
  currency: string;
  refund_policy: string | null;
  challenge_runtime: ChallengeRuntime;
  scoreboard_visibility: "public" | "participants" | "hidden";
  max_participants: number | null;
  cover_image_url: string | null;
  rules_markdown: string | null;
  total_registered: number;
  total_teams: number;
}

export interface CtfEventCreateInput {
  /** How far down the board the writeup requirement reaches; null = nobody. */
  writeup_required_top_n?: number | null;
  writeup_deadline?: string | null;
  slug: string;
  name: string;
  description?: string;
  overview_markdown?: string;
  format: CtfEventFormat;
  visibility: CtfEventVisibility;
  team_play: boolean;
  solo_play: boolean;
  max_team_size?: number | null;
  registration_starts_at: string;
  registration_ends_at: string;
  starts_at: string;
  ends_at: string;
  scoreboard_freeze_at?: string | null;
  dynamic_scoring: boolean;
  min_points: number;
  first_blood_bonus: number;
  required_tier: CtfRequiredTier;
  entry_fee_cents: number;
  currency: string;
  refund_policy?: string | null;
  challenge_runtime: ChallengeRuntime;
  scoreboard_visibility?: "public" | "participants" | "hidden";
  max_participants?: number | null;
  cover_image_url?: string | null;
  rules_markdown?: string;
}

/** Only these are editable after creation — ctf-svc rejects the rest. */
export type CtfEventUpdateInput = Partial<
  Pick<
    CtfEventCreateInput,
    | "name"
    | "description"
    | "overview_markdown"
    | "visibility"
    | "max_team_size"
    | "scoreboard_freeze_at"
    | "writeup_required_top_n"
    | "writeup_deadline"
    | "min_points"
    | "first_blood_bonus"
    | "max_participants"
    | "cover_image_url"
    | "rules_markdown"
    | "entry_fee_cents"
    | "currency"
    | "refund_policy"
    | "challenge_runtime"
    | "scoreboard_visibility"
    | "starts_at"
    | "registration_ends_at"
    | "ends_at"
  >
>;

/* ----------------------------- challenges ------------------------------- */

export interface AdminCtfChallenge {
  id: string;
  event_id: string;
  name: string;
  category: string;
  difficulty: string;
  description: string;
  base_points: number;
  current_points: number;
  total_solves: number;
  delivery_type: DeliveryType;
  connection_url: string | null;
  requires_instance: boolean;
  image_ref: string | null;
  files: ChallengeFile[];
  flag_pattern: string | null;
  sort_order: number;
  is_hidden: boolean;
}

export interface CtfChallengeInput {
  name: string;
  category: string;
  difficulty: string;
  description: string;
  base_points: number;
  /** `requires_instance` is derived from this server-side. */
  delivery_type: DeliveryType;
  /** Required when delivery_type is "shared_host". */
  connection_url?: string | null;
  /** Required when delivery_type is "per_player". */
  image_ref?: string | null;
  files?: ChallengeFile[];
  /** SHA-256 hex of the flag. Never send the plaintext flag to the API. */
  static_flag_hash?: string | null;
  flag_pattern?: string | null;
  sort_order?: number;
  is_hidden?: boolean;
  hints?: { id: string; text: string; point_deduction: number }[];
}

/**
 * ctf-svc stores the SHA-256 of the flag, never the flag itself, so hash in the
 * browser and send only the digest.
 */
export async function hashFlag(flag: string): Promise<string> {
  const bytes = new TextEncoder().encode(flag);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const ctfAdminApi = {
  /**
   * Delete an event and everything under it.
   *
   * The service refuses while an event is live — ending it first is a
   * deliberate, reversible step and deleting is not.
   */
  deleteEvent: (eventId: string) =>
    api.delete<void>(`/v1/ctf/events/${eventId}`),

  /** Delete a single challenge. Refused once the event has ended. */
  deleteChallenge: (eventId: string, challengeId: string) =>
    api.delete<void>(`/v1/ctf/events/${eventId}/challenges/${challengeId}`),

  listEvents: () =>
    api.get<{ items: AdminCtfEvent[] }>("/v1/ctf/events", { params: { limit: 100 } }),

  getEvent: (id: string) => api.get<AdminCtfEvent>(`/v1/ctf/events/${id}`),

  createEvent: (body: CtfEventCreateInput) =>
    api.post<AdminCtfEvent>("/v1/ctf/events", { body }),

  updateEvent: (id: string, body: CtfEventUpdateInput) =>
    api.patch<AdminCtfEvent>(`/v1/ctf/events/${id}`, { body }),

  publishEvent: (id: string) => api.post<AdminCtfEvent>(`/v1/ctf/events/${id}/publish`),
  endEvent: (id: string) => api.post<AdminCtfEvent>(`/v1/ctf/events/${id}/end`),

  /**
   * Pause or resume. Sending `paused: false` also clears any scheduled window —
   * an organiser pressing resume means the event is running, and a schedule
   * left armed would pause it again behind them.
   */
  setPause: (
    id: string,
    body: { paused?: boolean; starts_at?: string; ends_at?: string; reason?: string },
  ) => api.post<AdminCtfEvent>(`/v1/ctf/events/${id}/pause`, { body }),

  clearPauseSchedule: (id: string) =>
    api.delete<AdminCtfEvent>(`/v1/ctf/events/${id}/pause/schedule`),

  /**
   * Every entry in the event, banned ones included.
   *
   * Not the leaderboard: that filters disqualified rows out, which would make a
   * banned team invisible on the screen used to reinstate it.
   */
  listEntries: (eventId: string) =>
    api.get<{ items: AdminCtfEntry[] }>(`/v1/ctf/events/${eventId}/entries`),

  adjustScore: (
    eventId: string,
    body: { team_id?: string; user_id?: string; delta: number; reason?: string; visible?: boolean },
  ) => api.post<void>(`/v1/ctf/events/${eventId}/adjustments`, { body }),

  listAdjustments: (eventId: string) =>
    api.get<{ items: AdminCtfAdjustment[] }>(`/v1/ctf/events/${eventId}/adjustments`),

  setBan: (
    eventId: string,
    body: { team_id?: string; user_id?: string; banned: boolean; reason?: string },
  ) => api.post<void>(`/v1/ctf/events/${eventId}/ban`, { body }),

  /**
   * Fix an entry at a displayed position.
   *
   * This overrides the points ordering for one row, so the reason travels with
   * it — every pinned row is marked on the public board.
   */
  setRankPin: (
    eventId: string,
    body: { team_id?: string; user_id?: string; position: number; reason?: string },
  ) => api.post<void>(`/v1/ctf/events/${eventId}/rank-pins`, { body }),

  /**
   * Replace the displayed order in one call, from a dragged list.
   *
   * A PUT rather than a series of pins: moving one row shifts everything
   * between it and its new home, and sending that as N requests would leave the
   * board half-reordered if one failed.
   */
  reorderBoard: (
    eventId: string,
    order: { team_id?: string | null; user_id?: string | null; pinned: boolean }[],
    reason?: string,
  ) => api.put<{ pinned: number }>(`/v1/ctf/events/${eventId}/board-order`, { body: { order, reason } }),

  clearRankPin: (eventId: string, subject: { team_id?: string; user_id?: string }) =>
    api.delete<void>(`/v1/ctf/events/${eventId}/rank-pins`, { params: subject }),

  listWriteups: (eventId: string) =>
    api.get<{
      items: AdminCtfWriteup[];
      deadline: string | null;
      required_top_n: number | null;
      eliminated: {
        rank: number;
        display_name: string;
        team_id: string | null;
        user_id: string | null;
        points: number;
      }[];
    }>(`/v1/ctf/events/${eventId}/writeups`),

  listChallenges: (eventId: string) =>
    api.get<{ items: AdminCtfChallenge[] }>(`/v1/ctf/events/${eventId}/challenges`),

  createChallenge: (eventId: string, body: CtfChallengeInput) =>
    api.post<AdminCtfChallenge>(`/v1/ctf/events/${eventId}/challenges`, { body }),

  updateChallenge: (eventId: string, challengeId: string, body: Partial<CtfChallengeInput>) =>
    api.patch<AdminCtfChallenge>(
      `/v1/ctf/events/${eventId}/challenges/${challengeId}`,
      { body },
    ),

  /**
   * Once an event is live the service only accepts sort_order, is_hidden and
   * hints — everything else is frozen so the scoreboard stays meaningful.
   */
  liveEditableFields: ["sort_order", "is_hidden", "hints"] as const,
};

/* ------------------------------- banners -------------------------------- */

export type BannerKind = "ctf" | "machine" | "path" | "dojo" | "pro_lab" | "misc";

/**
 * Uploads to content-svc and returns the URL to store on the entity's
 * cover_image_url. One endpoint serves every entity type.
 */
export async function uploadChallengeFile(file: File): Promise<ChallengeFile> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const sha256 = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const form = new FormData();
  form.append("file", file);
  form.append("kind", "ctf");
  const res = await api.post<{ url: string }>("/v1/media/banner", { rawBody: form });
  return { name: file.name, url: res.url, size_bytes: file.size, sha256 };
}

export async function uploadBanner(file: File, kind: BannerKind): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  form.append("kind", kind);
  // rawBody so the browser sets the multipart boundary itself.
  const res = await api.post<{ url: string }>("/v1/media/banner", { rawBody: form });
  return res.url;
}
