import { api } from "@/lib/api";

/**
 * Event-wide solve feed (ctf-svc). Separate from the scoreboard: the same
 * solves, ordered by time rather than shaped into standings.
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

/** One team's cumulative points over time, for the scoreboard chart. */
export interface TeamSeries {
  team_id: string | null;
  name: string;
  points: number;
  points_over_time: { at: string; points: number }[];
}

export interface DifficultyBucket {
  difficulty: string;
  solved: number;
  total: number;
}

export interface TrendingStats {
  total_teams: number;
  total_players: number;
  mvp_name: string | null;
  mvp_team: string | null;
  mvp_points: number;
  popular_challenge: string | null;
  popular_category: string | null;
  popular_solves: number;
  valuable_challenge: string | null;
  valuable_category: string | null;
  valuable_points: number;
  solves_by_difficulty: DifficultyBucket[];
}

export const insightsApi = {
  series: (eventId: string, top = 10) =>
    api.get<TeamSeries[]>(`/v1/ctf/events/${eventId}/series`, { params: { top } }),
  trending: (eventId: string) =>
    api.get<TrendingStats>(`/v1/ctf/events/${eventId}/trending`),
};
