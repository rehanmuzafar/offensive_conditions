/**
 * The rank ladder.
 *
 * Ten ranks, earned by a single score that combines the three things the
 * platform actually measures: points, machines owned, and CTF challenges
 * solved. Points alone would rank a player who ground one category forever
 * above someone who did all three, which is the opposite of what a training
 * platform should reward.
 *
 * Machines and challenges are weighted rather than merely counted, because
 * points already scale with difficulty while a count does not — the weights say
 * "breadth is worth something on top of the score you got for it".
 *
 * The gaps widen sharply on purpose. A ladder whose rungs are evenly spaced
 * stops meaning anything once someone is a few hundred points in; one that
 * roughly doubles keeps the next rank a real target at every level.
 */

import type { Tier } from "@/types";

export interface Rank {
  tier: Tier;
  label: string;
  /** Combined score at which this rank begins. */
  at: number;
}

export const RANKS: Rank[] = [
  { tier: "noob", label: "Noob", at: 0 },
  { tier: "script_kiddie", label: "Script Kiddie", at: 500 },
  { tier: "hacker", label: "Hacker", at: 1_500 },
  { tier: "pro_hacker", label: "Pro Hacker", at: 4_000 },
  { tier: "elite_hacker", label: "Elite Hacker", at: 9_000 },
  { tier: "guru", label: "Guru", at: 20_000 },
  { tier: "elite_operator", label: "Elite Operator", at: 40_000 },
  { tier: "shadow_operator", label: "Shadow Operator", at: 80_000 },
  { tier: "phantom", label: "Phantom", at: 160_000 },
  { tier: "legend", label: "Legend", at: 320_000 },
];

export interface RankInput {
  points: number;
  machinesOwned: number;
  challengesSolved: number;
}

/**
 * A machine is worth more than a challenge because owning one is a longer
 * piece of work — enumeration, a foothold, then privilege escalation — against
 * a challenge's single objective.
 */
const MACHINE_WEIGHT = 100;
const CHALLENGE_WEIGHT = 25;

export function rankScore({ points, machinesOwned, challengesSolved }: RankInput): number {
  return (
    Math.max(0, points) +
    Math.max(0, machinesOwned) * MACHINE_WEIGHT +
    Math.max(0, challengesSolved) * CHALLENGE_WEIGHT
  );
}

export interface RankStanding {
  score: number;
  rank: Rank;
  /** Null at the top of the ladder — there is nothing left to climb to. */
  next: Rank | null;
  /** Score still needed for `next`. Zero when there is no next. */
  toNext: number;
  /** 0..1 through the current rank. 1 at the top. */
  progress: number;
}

export function standingFor(input: RankInput): RankStanding {
  const score = rankScore(input);

  // Walk down so the highest rank whose threshold is met wins.
  let index = 0;
  for (let i = RANKS.length - 1; i >= 0; i--) {
    if (score >= RANKS[i]!.at) {
      index = i;
      break;
    }
  }

  const rank = RANKS[index]!;
  const next = RANKS[index + 1] ?? null;
  if (!next) return { score, rank, next: null, toNext: 0, progress: 1 };

  const span = next.at - rank.at;
  return {
    score,
    rank,
    next,
    toNext: Math.max(0, next.at - score),
    // span is never zero — the thresholds strictly increase — but guarding
    // costs nothing and a NaN width would silently break the progress bar.
    progress: span > 0 ? Math.min(1, (score - rank.at) / span) : 1,
  };
}
