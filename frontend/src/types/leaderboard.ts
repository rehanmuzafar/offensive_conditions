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
  /** First bloods and the current daily streak — both shown on the landing ladder. */
  firstBloods: number;
  streakDays: number;
  /**
   * Bug reports that were actually taken, at a severity that means something.
   * Pending, rejected, duplicate and informational findings are excluded — a
   * count that included them would reward volume over signal.
   */
  acceptedBugs: number;
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
