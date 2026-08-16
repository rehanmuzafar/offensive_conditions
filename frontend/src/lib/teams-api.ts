/**
 * Teams (user-svc).
 *
 * The service already implemented the whole lifecycle — it was simply never
 * routed at the edge, so nothing could reach it.
 */

import { api } from "@/lib/api";

export type TeamCategory = "open" | "country" | "company" | "university" | "school";

export const CATEGORY_LABEL: Record<TeamCategory, string> = {
  open: "Open",
  country: "Country",
  company: "Company",
  university: "University",
  school: "School",
};

/** What `category_detail` should name, per category. */
export const CATEGORY_DETAIL_LABEL: Record<TeamCategory, string> = {
  open: "",
  country: "",
  company: "Company or organisation",
  university: "University or college",
  school: "School",
};

/**
 * CTF numbers for a team, keyed by user_id.
 *
 * These live in ctf-svc (`ctf.event_participants`), not user-svc, so the roster
 * and the stats are fetched separately and merged in the UI.
 */
export interface TeamMemberStats {
  user_id: string;
  points: number;
  flags: number;
  events_played: number;
  first_bloods: number;
  last_solve_at: string | null;
}

export interface TeamStats {
  team_id: string;
  points: number;
  flags: number;
  events_played: number;
  first_bloods: number;
  best_rank: number | null;
  last_solve_at: string | null;
  members: TeamMemberStats[];
}

export interface TeamJoinRequest {
  id: string;
  team_id: string;
  user_id: string;
  message: string;
  status: string;
  created_at: string;
}

export interface Team {
  id: string;
  name: string;
  slug: string;
  description: string;
  avatar_url: string;
  banner_url: string;
  country_code: string;
  website: string;
  category: TeamCategory;
  category_detail: string;
  is_private: boolean;
  is_recruiting: boolean;
  max_members: number;
  owner_id: string;
  member_count: number;
  created_at: string;
}

export interface TeamMember {
  team_id: string;
  user_id: string;
  role: string; // owner | captain | member
  joined_at: string;
  left_at: string | null;
}

export interface TeamInvitation {
  id: string;
  team_id: string;
  inviter_id: string;
  invitee_id: string;
  status: string;
  message: string;
  created_at: string;
  expires_at: string;
}

export interface CreateTeamInput {
  name: string;
  /** 3–32 chars, lowercase letters, digits and hyphens only. */
  slug: string;
  description?: string;
  avatar_url?: string;
  country_code?: string;
  website?: string;
  category?: TeamCategory;
  category_detail?: string;
  is_private?: boolean;
  is_recruiting?: boolean;
}

/** Every field optional; omitted means "do not filter on this". */
export interface BrowseFilter {
  q?: string;
  category?: TeamCategory | "";
  country?: string;
  detail?: string;
}

export const teamsApi = {
  /** Public teams, for discovery. Private teams are excluded server-side. */
  browse: async (f: BrowseFilter = {}): Promise<Team[]> =>
    (
      await api.get<{ teams: Team[] }>("/v1/teams", {
        params: {
          q: f.q ?? "",
          category: f.category ?? "",
          country: f.country ?? "",
          detail: f.detail ?? "",
        },
      })
    ).teams ?? [],

  getBySlug: async (slug: string): Promise<Team> =>
    (await api.get<{ team: Team }>(`/v1/teams/by-slug/${slug}`)).team,

  /**
   * Team CTF stats. Served by ctf-svc (hence the /ctf prefix), which owns the
   * participation rows the numbers are aggregated from.
   */
  stats: (teamId: string) => api.get<TeamStats>(`/v1/ctf/teams/${teamId}/stats`),

  requestJoin: (teamId: string, message = "") =>
    api.post<TeamJoinRequest>(`/v1/teams/${teamId}/join-requests`, { body: { message } }),

  joinRequests: async (teamId: string): Promise<TeamJoinRequest[]> =>
    (await api.get<{ requests: TeamJoinRequest[] }>(`/v1/teams/${teamId}/join-requests`)).requests ?? [],

  decideJoinRequest: (requestId: string, accept: boolean) =>
    api.post<{ status: string }>(
      `/v1/teams/join-requests/${requestId}/${accept ? "accept" : "decline"}`,
    ),

  listMine: async (): Promise<Team[]> =>
    (await api.get<{ teams: Team[] }>("/v1/teams/me")).teams ?? [],

  // user-svc wraps single teams as { team: … } — unwrap so callers get a Team.
  get: async (id: string): Promise<Team> =>
    (await api.get<{ team: Team }>(`/v1/teams/${id}`)).team,

  create: async (body: CreateTeamInput): Promise<Team> =>
    (await api.post<{ team: Team }>("/v1/teams", { body })).team,

  update: (id: string, body: Partial<CreateTeamInput>) =>
    api.patch<{ team: Team }>(`/v1/teams/${id}`, { body }),

  disband: (id: string) => api.delete<void>(`/v1/teams/${id}`),

  members: async (id: string): Promise<TeamMember[]> =>
    (await api.get<{ members: TeamMember[] }>(`/v1/teams/${id}/members`)).members ?? [],

  invite: (id: string, inviteeId: string, message = "") =>
    api.post<TeamInvitation>(`/v1/teams/${id}/invitations`, {
      body: { invitee_id: inviteeId, message },
    }),

  myInvitations: async (): Promise<TeamInvitation[]> =>
    (await api.get<{ invitations: TeamInvitation[] }>("/v1/teams/invitations/me")).invitations ?? [],

  acceptInvite: (invitationId: string) =>
    api.post<void>(`/v1/teams/invitations/${invitationId}/accept`),

  declineInvite: (invitationId: string) =>
    api.post<void>(`/v1/teams/invitations/${invitationId}/decline`),

  leave: (id: string) => api.post<void>(`/v1/teams/${id}/leave`),
  kick: (id: string, userId: string) => api.post<void>(`/v1/teams/${id}/kick/${userId}`),
  promote: (id: string, userId: string) => api.post<void>(`/v1/teams/${id}/promote/${userId}`),
};

export interface UserSearchResult {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string;
  country_code: string;
}

/**
 * Find people to invite. Teams are keyed by user id internally, but nobody
 * types a UUID — this is what turns the invite box into something usable.
 */
export async function searchUsers(q: string, limit = 8): Promise<UserSearchResult[]> {
  if (q.trim().length < 2) return [];
  const res = await api.get<{ results: UserSearchResult[] }>("/v1/users/search", {
    params: { q: q.trim(), limit },
  });
  return res.results ?? [];
}

/** Resolve a single user id to a name — the roster only stores ids. */
export async function getUsername(userId: string): Promise<string> {
  try {
    const res = await api.get<{ profile?: { username?: string; display_name?: string } }>(
      `/v1/users/${userId}`,
    );
    return res.profile?.username || res.profile?.display_name || userId.slice(0, 8);
  } catch {
    return userId.slice(0, 8);
  }
}

/** user-svc validates this server-side; mirror it so the form fails fast. */
export function slugifyTeam(v: string): string {
  return v.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
}
