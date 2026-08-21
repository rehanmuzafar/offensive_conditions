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
  /**
   * Long-form copy for the event page.
   *
   * Carried by the API as `rules_markdown` — the column predates the field
   * being used this way, and renaming it needs a backend migration. It is
   * presented as "About" everywhere a human sees it.
   */
  about?: string | null;
  /**
   * Who may read the standings: everyone, only entrants, or nobody outside the
   * admin panel. Set when the event is created.
   */
  scoreboardVisibility: "public" | "participants" | "hidden";
  /**
   * Whether play is stopped right now — by hand or by a scheduled window.
   * Not a status: the event is still live, it is just not accepting flags.
   */
  isPaused: boolean;
  pauseStartsAt: string | null;
  pauseEndsAt: string | null;
  pauseReason: string | null;
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
  /**
   * How the challenge is served, which decides what the access control offers:
   * `static` has nothing to connect to, `shared_host` has one address everyone
   * uses, and `per_player` needs a container started for the player.
   */
  deliveryType: "static" | "shared_host" | "per_player";
  firstBlood: { username: string; at: string } | null;
}

export interface ScoreboardRow {
  rank: number;
  /**
   * Organiser bonuses this board is allowed to explain. Quiet adjustments are
   * already inside `points` and never appear here — that is the whole point of
   * the choice the organiser makes when applying one.
   */
  bonuses?: { delta: number; reason: string }[];
  /**
   * This position was set by an organiser, not earned by points. Surfaced on
   * purpose: a board that silently overrides its own ordering is worse than one
   * that admits it did.
   */
  pinned?: boolean;
  pinnedReason?: string | null;
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

/** A captain's team as it stands for one event. */
export interface EventRoster {
  teamId: string;
  teamName: string;
  maxTeamSize: number | null;
  /** True once the event starts: slots stop moving because solves have begun. */
  locked: boolean;
  members: { userId: string; username: string; role: string; entered: boolean }[];
}

/** A writeup attached to one event entry. */
export interface EventWriteup {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  /** draft is replaceable; submitted is final and counts against the deadline. */
  status: "draft" | "submitted";
  submittedAt: string | null;
  updatedAt: string | null;
}

export interface MyWriteup {
  writeup: EventWriteup | null;
  deadline: string | null;
  /** How far down the board the requirement reaches; null means nobody owes one. */
  requiredTopN: number | null;
  allowedExtensions: string[];
}
