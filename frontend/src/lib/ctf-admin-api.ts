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
  listEvents: () =>
    api.get<{ items: AdminCtfEvent[] }>("/v1/ctf/events", { params: { limit: 100 } }),

  getEvent: (id: string) => api.get<AdminCtfEvent>(`/v1/ctf/events/${id}`),

  createEvent: (body: CtfEventCreateInput) =>
    api.post<AdminCtfEvent>("/v1/ctf/events", { body }),

  updateEvent: (id: string, body: CtfEventUpdateInput) =>
    api.patch<AdminCtfEvent>(`/v1/ctf/events/${id}`, { body }),

  publishEvent: (id: string) => api.post<AdminCtfEvent>(`/v1/ctf/events/${id}/publish`),
  endEvent: (id: string) => api.post<AdminCtfEvent>(`/v1/ctf/events/${id}/end`),

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
