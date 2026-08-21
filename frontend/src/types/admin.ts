/**
 * Admin types — platform metrics, moderation, user management, broadcasts.
 * Mirror the admin-facing endpoints across services.
 */

import type { Role } from "./auth";
import type { MachineDifficulty, Os } from "./index";
import type { ReportState, Severity } from "./bounty";

/* -------------------------------- overview -------------------------------- */
export interface AdminOverview {
  metrics: {
    totalUsers: number;
    activeUsers30d: number;
    totalMachines: number;
    activeMachines: number;
    runningInstances: number;
    openReports: number;
    pendingPayoutsCents: number;
    mrrCents: number;
  };
  trends: {
    signups7d: number[];
    flagsSubmitted7d: number[];
  };
  recentSignups: { username: string; country: string | null; at: string }[];
  systemHealth: { service: string; status: "healthy" | "degraded" | "down"; latencyMs: number }[];
}

/* ------------------------------- moderation ------------------------------- */
export interface AdminMachine {
  id: string;
  slug: string;
  name: string;
  os: Os;
  difficulty: MachineDifficulty;
  status: "draft" | "queued" | "active" | "retired";
  points: number;
  userOwns: number;
  rootOwns: number;
  maker: string;
  releasedAt: string | null;
  isFree: boolean;
}

export interface AdminReportQueue {
  id: string;
  shortId: string;
  programName: string;
  programSlug: string;
  title: string;
  severity: Severity;
  state: ReportState;
  /** Researcher's username. Null only if the account was deleted. */
  reporter: string | null;
  /** Triager's username, once someone has picked it up. */
  assignedTo: string | null;
  ageHours: number;
  slaBreached: boolean;
  bountyCents: number;
  bountyCurrency: string | null;
}

export interface AdminUser {
  id: string;
  username: string;
  email: string;
  country: string | null;
  roles: Role[];
  status: "active" | "suspended" | "banned";
  points: number;
  joinedAt: string;
  lastSeenAt: string;
}

export interface FlaggedContent {
  id: string;
  kind: "thread" | "post" | "writeup";
  title: string;
  author: string;
  reason: string;
  reportedBy: string;
  reportCount: number;
  at: string;
  excerpt: string;
}

/* ------------------------------- broadcasts ------------------------------- */
export interface Broadcast {
  id: string;
  title: string;
  body: string;
  audience: "all" | "pro" | "free" | "staff";
  channel: ("in_app" | "email" | "push")[];
  status: "draft" | "scheduled" | "sent";
  scheduledFor: string | null;
  sentAt: string | null;
  recipientCount: number;
}
