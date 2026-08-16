/**
 * Content + lab types — machines, instances, VPN, and dashboard models.
 * Mirror content-svc + orchestrator API contracts.
 */

import type { MachineDifficulty, Os, Tier } from "./index";

export type { MachineDifficulty, Os } from "./index";

/** A machine card in the catalog. */
export interface Machine {
  id: string;
  slug: string;
  name: string;
  os: Os;
  difficulty: MachineDifficulty;
  points: number;
  rating: number; // 0..5
  ratingCount: number;
  userOwns: number;
  rootOwns: number;
  isActive: boolean;
  isFree: boolean;
  releasedAt: string;
  retiresAt: string | null;
  tags: string[];
  makers: { username: string; avatarUrl: string | null }[];
  thumbnailColor: string; // brand-ish accent for the card header
}

/** Full machine detail (the play page). */
export interface MachineDetail extends Machine {
  description: string;
  // user-specific progress
  progress: {
    userFlagged: boolean;
    rootFlagged: boolean;
    userFlaggedAt: string | null;
    rootFlaggedAt: string | null;
  };
}

export type InstanceState =
  | "queued"
  | "provisioning"
  | "running"
  | "stopping"
  | "stopped"
  | "error"
  | "expired";

/** A spawned lab instance. */
export interface Instance {
  id: string;
  machineId: string;
  machineName: string;
  state: InstanceState;
  ipAddress: string | null;
  spawnedAt: string | null;
  expiresAt: string | null;
  // % done while provisioning (0..100)
  provisionProgress: number;
}

export type FlagKind = "user" | "root";

export interface FlagSubmitResult {
  accepted: boolean;
  kind: FlagKind;
  pointsAwarded: number;
  firstBlood: boolean;
  alreadyOwned: boolean;
}

export interface VpnConfig {
  id: string;
  region: string;
  filename: string;
  config: string; // wireguard .conf text
  serverHost: string;
}

/* ----------------------------- dashboard ------------------------------ */

export interface DashboardSummary {
  user: {
    username: string;
    tier: Tier;
    rank: number;
    points: number;
    nextTier: { tier: Tier; pointsNeeded: number } | null;
  };
  stats: {
    machinesOwned: number;
    challengesSolved: number;
    currentStreakDays: number;
    globalRank: number;
  };
  activeTrack: {
    slug: string;
    name: string;
    completed: number;
    total: number;
  } | null;
  recentActivity: ActivityItem[];
}

export interface ActivityItem {
  id: string;
  type: "user_own" | "root_own" | "challenge_solve" | "rank_up" | "badge" | "ctf";
  title: string;
  subtitle: string;
  points: number | null;
  at: string;
}

/* ------------------------------ tracks ---------------------------------- */

export type TrackDifficulty = "beginner" | "intermediate" | "advanced" | "expert";

export interface Track {
  id: string;
  slug: string;
  name: string;
  description: string;
  difficulty: TrackDifficulty;
  moduleCount: number;
  estimatedHours: number;
  tags: string[];
  isFree: boolean;
  isNew: boolean;
  thumbnailColor: string;
  /** Progress for the authenticated user (null if not started). */
  progress: { completed: number; total: number } | null;
}

export interface TrackModule {
  id: string;
  order: number;
  title: string;
  description: string;
  type: "theory" | "lab" | "challenge" | "boss";
  estimatedMinutes: number;
  isLocked: boolean;
  completed: boolean;
}

export interface TrackDetail extends Track {
  longDescription: string;
  skills: string[];
  modules: TrackModule[];
}
