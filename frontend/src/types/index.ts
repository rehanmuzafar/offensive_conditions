/**
 * Shared domain types used across the frontend. These mirror the API
 * responses from the gateway (auth, scoring, content, etc). Page-specific
 * types live next to their features; these are the cross-cutting ones.
 */

export type Severity = "critical" | "high" | "medium" | "low" | "informational";

export type MachineDifficulty = "easy" | "medium" | "hard" | "insane";

export type Os = "linux" | "windows" | "other";

/** Reputation tiers shown next to handles. */
export type Tier =
  | "noob"
  | "script_kiddie"
  | "hacker"
  | "pro_hacker"
  | "elite_hacker"
  | "guru"
  | "elite_operator";

export interface UserSummary {
  id: string;
  username: string;
  avatarUrl: string | null;
  country: string | null; // ISO alpha-2
  tier: Tier;
  rank: number | null;
  points: number;
}

export interface LeaderboardEntry {
  rank: number;
  user: UserSummary;
  points: number;
  change: number; // rank delta vs previous period
}

export interface MachineSummary {
  id: string;
  slug: string;
  name: string;
  os: Os;
  difficulty: MachineDifficulty;
  points: number;
  rating: number;
  userOwns: number;
  rootOwns: number;
  isActive: boolean;
  releasedAt: string;
}

export interface Paginated<T> {
  items: T[];
  meta: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export interface CursorPage<T> {
  items: T[];
  meta: {
    nextCursor: string | null;
    hasMore: boolean;
  };
}
