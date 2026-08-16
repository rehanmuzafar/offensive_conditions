/**
 * Bounty types — programs, reports, payouts. Mirror bounty-svc API.
 */

import type { Severity } from "./index";
import type { ForumAuthor } from "./forum";

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

export interface BountyProgram {
  id: string;
  slug: string;
  name: string;
  orgName: string;
  status: ProgramStatus;
  visibility: ProgramVisibility;
  currency: string;
  minRewardCents: number;
  maxRewardCents: number;
  totalReports: number;
  totalPaidCents: number;
  responseSlaHours: number;
  safeHarbor: boolean;
  bannerColor: string;
  publishedAt: string | null;
  tags: string[];
}

export interface BountyProgramDetail extends BountyProgram {
  description: string;
  policy: string;
  inScopeSummary: string;
  outOfScopeSummary: string;
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
  updatedAt: string;
}

export interface ReportComment {
  id: string;
  author: ForumAuthor;
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
  comments: ReportComment[];
  transitions: ReportStateTransition[];
}

export interface Payout {
  id: string;
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
  severity: Severity;
  cvssVector?: string;
}
