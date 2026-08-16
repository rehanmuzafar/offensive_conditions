/**
 * CTF types — events, challenges, scoreboard. Mirror ctf-svc API.
 */

import type { Severity } from "./index";

export type CtfState = "upcoming" | "live" | "ended";
export type CtfFormat = "jeopardy" | "attack_defense";

export interface CtfEvent {
  id: string;
  slug: string;
  name: string;
  description: string;
  format: CtfFormat;
  state: CtfState;
  startsAt: string;
  endsAt: string;
  participantCount: number;
  teamCount: number;
  challengeCount: number;
  prizePool: string | null;
  bannerColor: string;
  /** Uploaded cover image, if the organiser set one. */
  bannerImageUrl: string | null;
  /** Real ctf-svc lifecycle status — draft is only ever visible to organisers. */
  status: string;
  /** Team events register a team; solo events register the individual. */
  teamPlay: boolean;
  soloPlay: boolean;
  maxTeamSize: number | null;
  isRegistered: boolean;
}

export type ChallengeCategory =
  | "web"
  | "pwn"
  | "crypto"
  | "reverse"
  | "forensics"
  | "osint"
  | "misc"
  | "hardware";

export interface CtfChallenge {
  id: string;
  title: string;
  category: ChallengeCategory;
  points: number;
  /** Full value, before dynamic scoring decays it. */
  basePoints?: number;
  difficulty: Severity;
  description: string;
  solveCount: number;
  solved: boolean;
  files: { name: string; sizeBytes: number; url: string }[];
  hints: { id: string; cost: number; unlocked: boolean; text: string | null }[];
  connectionInfo: string | null;
  firstBlood: { username: string; at: string } | null;
}

export interface ScoreboardRow {
  rank: number;
  /** ISO alpha-2 from the team record; null for solo entries. */
  countryCode?: string | null;
  firstBloods?: number;
  teamId: string;
  teamName: string;
  country: string | null;
  points: number;
  solveCount: number;
  lastSolveAt: string | null;
  change: number;
}

export interface ChallengeSolveResult {
  correct: boolean;
  pointsAwarded: number;
  firstBlood: boolean;
  alreadySolved: boolean;
}
