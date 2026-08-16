"use client";

/**
 * Profile hook — fetches a public user profile by username from user-svc and
 * maps the snake_case wire shape into the camelCase PublicProfile type.
 */

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { PublicProfile } from "@/types/profile";

interface ProfileResponse {
  profile: {
    user_id: string;
    username: string;
    email?: string;
    display_name: string;
    bio: string;
    avatar_url: string;
    country_code?: string;
    tier: string;
    is_staff: boolean;
    created_at: string;
    social: { twitter: string; github: string; linkedin: string; website: string };
  };
}

export function useProfile(username: string) {
  return useQuery({
    queryKey: ["profile", username],
    enabled: Boolean(username),
    retry: false,
    queryFn: async (): Promise<PublicProfile> => {
      const { profile: p } = await api.get<ProfileResponse>(
        `/v1/users/by-username/${encodeURIComponent(username)}`,
      );
      return {
        userId: p.user_id,
        username: p.username,
        displayName: p.display_name,
        bio: p.bio,
        avatarUrl: p.avatar_url || null,
        countryCode: p.country_code || null,
        tier: p.tier,
        isStaff: p.is_staff,
        createdAt: p.created_at,
        social: p.social,
        email: p.email,
      };
    },
  });
}

/**
 * A player's CTF record, served by ctf-svc rather than user-svc — it aggregates
 * `ctf.event_participants` across every event the player entered, solo or with
 * a team.
 */
export interface PlayerCtfStats {
  user_id: string;
  points: number;
  flags: number;
  events_played: number;
  first_bloods: number;
  best_rank: number | null;
  teams_played_with: number;
  last_solve_at: string | null;
}

export function useCtfStats(userId: string | undefined) {
  return useQuery({
    queryKey: ["ctf-stats", userId],
    enabled: Boolean(userId),
    retry: false,
    queryFn: () => api.get<PlayerCtfStats>(`/v1/ctf/users/${userId}/ctf-stats`),
  });
}
