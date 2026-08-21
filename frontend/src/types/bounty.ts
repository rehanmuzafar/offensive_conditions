/**
 * Bounty types — programs, reports, payouts. Mirror bounty-svc API.
 */

import type { Severity } from "./index";

export type { Severity } from "./index";

export type ProgramStatus = "draft" | "published" | "paused" | "closed";
export type ProgramVisibility = "public" | "invite_only" | "private";

export interface RewardTier {
  severity: Severity;
  minCents: number;
  maxCents: number;
  currency: string;
}

export interface ScopeItem {
  assetType: "domain" | "wildcard" | "ip" | "ip_range" | "mobile_app" | "source_code" | "api" | "other";
  assetIdentifier: string;
  severityMax: Severity;
  inScope: boolean;
  notes: string | null;
}

export interface AssetTypeCount {
  assetType: string;
  count: number;
}

export interface BountyProgram {
  id: string;
  slug: string;
  name: string;
  status: ProgramStatus;
  visibility: ProgramVisibility;
  currency: string;
  minRewardCents: number;
  maxRewardCents: number;
  totalReports: number;
  totalPaidCents: number;
  responseSlaHours: number;
  safeHarbor: boolean;
  /** Derived from the slug — see programColor. Not an authored field. */
  bannerColor: string;
  publishedAt: string | null;
  disclosurePolicy: string;
  /** In-scope asset types with counts. See ProgramService.card_stats. */
  assetCounts: AssetTypeCount[];
  /** Distinct researchers who have reported. */
  hackers: number;
  /** 0..1, or null when nothing is old enough to judge the SLA against. */
  responseEfficiency: number | null;
}

export interface BountyProgramDetail extends BountyProgram {
  description: string;
  policy: string;
  inScopeSummary: string;
  outOfScopeSummary: string;
  triageSlaHours: number;
  resolutionSlaDays: number;
  scope: ScopeItem[];
  rewards: RewardTier[];
}

export type ReportState =
  | "submitted"
  | "triaging"
  | "accepted"
  | "rejected"
  | "duplicate"
  | "informational"
  | "resolved"
  | "paid"
  | "closed";

export interface BountyReport {
  id: string;
  shortId: string;
  programId: string;
  /** Empty on list endpoints, which do not join the program. */
  programSlug: string;
  programName: string;
  title: string;
  severity: Severity;
  cvssScore: number | null;
  state: ReportState;
  bountyCents: number;
  bountyCurrency: string | null;
  assetIdentifier: string;
  createdAt: string;
}

export interface ReportComment {
  id: string;
  authorId: string;
  /** Resolved server-side; "deleted account" when the user is gone. */
  authorName: string;
  authorRole: string;
  bodyMd: string;
  visibility: "public" | "internal";
  isStateChange: boolean;
  createdAt: string;
}

export interface ReportStateTransition {
  id: string;
  fromState: ReportState | null;
  toState: ReportState;
  actorName: string;
  reason: string | null;
  at: string;
}

export interface BountyReportDetail extends BountyReport {
  descriptionMd: string;
  reproductionSteps: string;
  impact: string;
  vrtCategory: string | null;
  cvssVector: string | null;
  rejectionReason: string | null;
  researcherName: string | null;
}

export interface Payout {
  id: string;
  reportId: string;
  reportShortId: string;
  programName: string;
  amountCents: number;
  currency: string;
  state: "requested" | "processing" | "paid" | "failed" | "canceled";
  requestedAt: string;
  paidAt: string | null;
}

export interface ReportCreate {
  title: string;
  descriptionMd: string;
  reproductionSteps: string;
  impact: string;
  assetIdentifier: string;
  /** Vulnerability taxonomy label, e.g. "XSS — Stored". Optional. */
  vrtCategory?: string;
  severity: Severity;
  cvssVector?: string;
}


/** One row of a program's thanks page. Reputation is severity-weighted. */
export interface ThanksEntry {
  researcherId: string;
  username: string;
  accepted: number;
  criticals: number;
  reputation: number;
  earnedCents: number;
}

export interface Collaborator {
  researcherId: string;
  username: string;
  reports: number;
  lastReportAt: string;
}

export interface ProgramUpdate {
  id: string;
  title: string;
  bodyMd: string;
  authorName: string | null;
  createdAt: string;
}


/** A disclosed report, as the public hacktivity index shows it. */
export interface HacktivityItem {
  id: string;
  shortId: string;
  title: string;
  severity: Severity;
  state: ReportState;
  vrtCategory: string | null;
  bountyCents: number;
  bountyCurrency: string | null;
  programName: string;
  programSlug: string;
  researcherName: string;
  publishedAt: string;
}

/** One weakness class, counted across every report on the platform. */
export interface WeaknessRow {
  name: string;
  reports: number;
  severe: number;
  accepted: number;
}
