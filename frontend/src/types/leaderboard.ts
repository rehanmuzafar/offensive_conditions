/**
 * Leaderboard + scoring types — mirror scoring-svc API.
 */

import type { Tier } from "./index";

export interface LeaderRow {
  rank: number;
  userId: string;
  username: string;
  avatarUrl: string | null;
  country: string | null; // ISO alpha-2
  tier: Tier;
  points: number;
  ownedMachines: number;
  solvedChallenges: number;
  /** rank change vs previous period: +up / -down / 0 */
  change: number;
}

export type LeaderboardScope = "global" | "season" | "country" | "team";
export type LeaderboardWindow = "all_time" | "monthly" | "weekly";

export interface Season {
  id: string;
  name: string;
  number: number;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
}

export interface HallOfFameEntry {
  season: Season;
  champion: LeaderRow;
}
