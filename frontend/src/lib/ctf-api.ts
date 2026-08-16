import { api } from "@/lib/api";

/**
 * Event-wide solve feed (ctf-svc). Separate from the scoreboard: same solves,
 * ordered by time rather than shaped into standings.
 */
export interface ActivityItem {
  solved_at: string;
  challenge_id: string;
  challenge_name: string;
  category: string;
  is_first_blood: boolean;
  team_id: string | null;
  /** Empty for a solo entry — render "A player" rather than inventing a name. */
  actor: string;
}

export const activityApi = {
  list: (eventId: string, limit = 50) =>
    api.get<ActivityItem[]>(`/v1/ctf/events/${eventId}/activity`, { params: { limit } }),
};
