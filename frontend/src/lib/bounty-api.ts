/**
 * Bug bounty API — programs, reports, comments, payouts.
 *
 * Split out of account-api, which declared these endpoints returning camelCase
 * types and then handed the raw response straight through. bounty-svc speaks
 * snake_case, so every field the pages read was `undefined`: report titles,
 * severities, program names, the lot. Everything below maps explicitly.
 */

import { api } from "@/lib/api";
import type { Paginated } from "@/types";
import type {
  BountyProgram,
  BountyProgramDetail,
  BountyReport,
  BountyReportDetail,
  Payout,
  ReportComment,
  ReportCreate,
  ReportState,
  ReportStateTransition,
  RewardTier,
  Collaborator,
  HacktivityItem,
  ProgramUpdate,
  ScopeItem,
  Severity,
  ThanksEntry,
  WeaknessRow,
} from "@/types/bounty";

/* --------------------------------- wire ---------------------------------- */

interface RawProgram {
  id: string;
  slug: string;
  name: string;
  description: string;
  visibility: BountyProgram["visibility"];
  status: BountyProgram["status"];
  currency: string;
  min_reward_cents: number | null;
  max_reward_cents: number | null;
  disclosure_policy: string;
  safe_harbor: boolean;
  response_sla_hours: number;
  published_at: string | null;
  total_reports: number;
  total_payouts_cents: number;
  created_at: string;
  asset_counts?: Array<{ asset_type: string; count: number }>;
  hackers?: number;
  response_efficiency?: number | null;
}

interface RawProgramDetail extends RawProgram {
  policy: string;
  triage_sla_hours: number;
  resolution_sla_days: number;
  in_scope_summary: string | null;
  out_of_scope_summary: string | null;
}

interface RawReport {
  id: string;
  short_id: string;
  program_id: string;
  researcher_id: string;
  title: string;
  asset_identifier: string | null;
  vrt_category: string | null;
  severity: Severity;
  cvss_vector: string | null;
  cvss_score: string | number | null;
  state: ReportState;
  bounty_cents: number;
  bounty_currency: string | null;
  created_at: string;
  program_name?: string | null;
  program_slug?: string | null;
  researcher_name?: string | null;
}

interface RawReportDetail extends RawReport {
  description_md: string;
  reproduction_steps: string;
  impact: string;
  rejection_reason: string | null;
}

interface RawComment {
  id: string;
  author_id: string;
  author_name: string | null;
  author_role: string;
  visibility: string;
  body_md: string;
  is_state_change: boolean;
  created_at: string;
}

interface RawTimelineEntry {
  id: string;
  from_state: ReportState | null;
  to_state: ReportState;
  reason: string | null;
  actor_id: string;
  actor_name: string | null;
  created_at: string;
}

interface RawPayout {
  id: string;
  report_id: string;
  report_short_id: string | null;
  program_name: string | null;
  amount_cents: number;
  currency: string;
  state: Payout["state"];
  requested_at: string;
  paid_at: string | null;
}

/* -------------------------------- mappers -------------------------------- */

/**
 * A stable identifying colour per program.
 *
 * The card has always drawn one and the API has never had a field for it.
 * Deriving it from the slug keeps the visual and keeps it honest — it is a
 * hash of the name, not a colour anyone chose, and it does not change between
 * renders the way a random one would.
 */
function programColor(slug: string): string {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) % 360;
  return `hsl(${h} 70% 60%)`;
}

function mapProgram(p: RawProgram): BountyProgram {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    status: p.status,
    visibility: p.visibility,
    currency: p.currency,
    minRewardCents: p.min_reward_cents ?? 0,
    maxRewardCents: p.max_reward_cents ?? 0,
    totalReports: p.total_reports,
    totalPaidCents: p.total_payouts_cents,
    responseSlaHours: p.response_sla_hours,
    safeHarbor: p.safe_harbor,
    bannerColor: programColor(p.slug),
    publishedAt: p.published_at,
    disclosurePolicy: p.disclosure_policy,
    assetCounts: (p.asset_counts ?? []).map((a) => ({
      assetType: a.asset_type,
      count: a.count,
    })),
    hackers: p.hackers ?? 0,
    // `?? null` and not `|| null`: 0 is a real efficiency and must survive.
    responseEfficiency: p.response_efficiency ?? null,
  };
}

function mapProgramDetail(p: RawProgramDetail): BountyProgramDetail {
  return {
    ...mapProgram(p),
    description: p.description,
    policy: p.policy,
    inScopeSummary: p.in_scope_summary ?? "",
    outOfScopeSummary: p.out_of_scope_summary ?? "",
    triageSlaHours: p.triage_sla_hours,
    resolutionSlaDays: p.resolution_sla_days,
    scope: [],
    rewards: [],
  };
}

function mapReport(r: RawReport): BountyReport {
  return {
    id: r.id,
    shortId: r.short_id,
    programId: r.program_id,
    programSlug: r.program_slug ?? "",
    programName: r.program_name ?? "",
    title: r.title,
    severity: r.severity,
    // Postgres NUMERIC arrives as a string; Number("") is 0, which would show
    // a CVSS of 0.0 on every report that has none.
    cvssScore: r.cvss_score == null ? null : Number(r.cvss_score),
    state: r.state,
    bountyCents: r.bounty_cents,
    bountyCurrency: r.bounty_currency,
    assetIdentifier: r.asset_identifier ?? "",
    createdAt: r.created_at,
  };
}

function mapReportDetail(r: RawReportDetail): BountyReportDetail {
  return {
    ...mapReport(r),
    descriptionMd: r.description_md,
    reproductionSteps: r.reproduction_steps,
    impact: r.impact,
    vrtCategory: r.vrt_category,
    cvssVector: r.cvss_vector,
    rejectionReason: r.rejection_reason,
    researcherName: r.researcher_name ?? null,
  };
}

function mapComment(c: RawComment): ReportComment {
  return {
    id: c.id,
    authorId: c.author_id,
    authorName: c.author_name ?? "deleted account",
    authorRole: c.author_role,
    bodyMd: c.body_md,
    visibility: c.visibility === "internal" ? "internal" : "public",
    isStateChange: c.is_state_change,
    createdAt: c.created_at,
  };
}

function mapTimeline(t: RawTimelineEntry): ReportStateTransition {
  return {
    id: t.id,
    fromState: t.from_state,
    toState: t.to_state,
    actorName: t.actor_name ?? "system",
    reason: t.reason,
    at: t.created_at,
  };
}

function mapPayout(p: RawPayout): Payout {
  return {
    id: p.id,
    reportId: p.report_id,
    reportShortId: p.report_short_id ?? "",
    programName: p.program_name ?? "",
    amountCents: p.amount_cents,
    currency: p.currency,
    state: p.state,
    requestedAt: p.requested_at,
    paidAt: p.paid_at,
  };
}

/* ---------------------------------- api ---------------------------------- */

export const bountyApi = {
  listPrograms: async (
    params: { q?: string; assetType?: string; hasBounty?: boolean; limit?: number } = {},
  ): Promise<Paginated<BountyProgram>> => {
    const res = await api.get<{ items: RawProgram[]; meta: Paginated<never>["meta"] }>(
      "/v1/programs",
      {
        params: {
          q: params.q,
          asset_type: params.assetType,
          has_bounty: params.hasBounty,
          limit: params.limit,
        },
      },
    );
    return { items: (res.items ?? []).map(mapProgram), meta: res.meta };
  },

  getProgram: async (slug: string): Promise<BountyProgramDetail> => {
    // Scope and reward tiers are separate endpoints, and the detail page shows
    // all three together, so they are fetched together rather than leaving the
    // page to orchestrate three requests.
    const [program, scope, rewards] = await Promise.all([
      api.get<RawProgramDetail>(`/v1/programs/${slug}`),
      api
        .get<{ items: Array<Record<string, unknown>> }>(`/v1/programs/${slug}/scope`)
        .catch(() => ({ items: [] })),
      api
        .get<{ items: Array<Record<string, unknown>> }>(`/v1/programs/${slug}/rewards`)
        .catch(() => ({ items: [] })),
    ]);
    return {
      ...mapProgramDetail(program),
      scope: (scope.items ?? []).map(
        (s): ScopeItem => ({
          assetType: s.asset_type as ScopeItem["assetType"],
          assetIdentifier: String(s.asset_identifier ?? ""),
          severityMax: (s.severity_max as Severity) ?? "critical",
          inScope: Boolean(s.in_scope),
          notes: (s.notes as string) ?? null,
        }),
      ),
      rewards: (rewards.items ?? []).map(
        (r): RewardTier => ({
          severity: r.severity as Severity,
          minCents: Number(r.min_cents ?? 0),
          maxCents: Number(r.max_cents ?? 0),
          currency: String(r.currency ?? program.currency),
        }),
      ),
    };
  },

  submitReport: async (slug: string, body: ReportCreate): Promise<BountyReport> =>
    mapReport(
      await api.post<RawReport>(`/v1/programs/${slug}/reports`, {
        body: {
          title: body.title,
          description_md: body.descriptionMd,
          reproduction_steps: body.reproductionSteps,
          impact: body.impact,
          asset_identifier: body.assetIdentifier || null,
          vrt_category: body.vrtCategory || null,
          severity: body.severity,
          cvss_vector: body.cvssVector || null,
        },
      }),
    ),

  myReports: async (state?: string): Promise<Paginated<BountyReport>> => {
    const res = await api.get<{ items: RawReport[]; meta: Paginated<never>["meta"] }>(
      "/v1/me/reports",
      { params: { state } },
    );
    return { items: (res.items ?? []).map(mapReport), meta: res.meta };
  },

  getReport: async (id: string): Promise<BountyReportDetail> =>
    mapReportDetail(await api.get<RawReportDetail>(`/v1/reports/${id}`)),

  comments: async (id: string): Promise<ReportComment[]> => {
    const res = await api.get<{ items: RawComment[] }>(`/v1/reports/${id}/comments`);
    return (res.items ?? []).map(mapComment);
  },

  timeline: async (id: string): Promise<ReportStateTransition[]> => {
    const res = await api.get<{ items: RawTimelineEntry[] }>(`/v1/reports/${id}/timeline`);
    return (res.items ?? []).map(mapTimeline);
  },

  comment: (id: string, bodyMd: string, visibility: "public" | "internal" = "public") =>
    api.post<void>(`/v1/reports/${id}/comments`, { body: { body_md: bodyMd, visibility } }),

  hacktivity: async (
    params: { program?: string; severity?: string; q?: string; limit?: number } = {},
  ): Promise<HacktivityItem[]> => {
    const res = await api.get<{ items: Array<{
      id: string; short_id: string; title: string; severity: Severity;
      state: ReportState; vrt_category: string | null;
      bounty_cents: number; bounty_currency: string | null;
      program_name: string; program_slug: string;
      researcher_name: string | null; published_at: string;
    }> }>("/v1/hacktivity", { params });
    return (res.items ?? []).map((r) => ({
      id: r.id,
      shortId: r.short_id,
      title: r.title,
      severity: r.severity,
      state: r.state,
      vrtCategory: r.vrt_category,
      bountyCents: r.bounty_cents,
      bountyCurrency: r.bounty_currency,
      programName: r.program_name,
      programSlug: r.program_slug,
      researcherName: r.researcher_name ?? "deleted account",
      publishedAt: r.published_at,
    }));
  },

  weaknesses: async (): Promise<WeaknessRow[]> => {
    const rows = await api.get<Array<{
      name: string; reports: number; severe: number; accepted: number;
    }>>("/v1/hacktivity/weaknesses");
    return rows ?? [];
  },

  thanks: async (slug: string): Promise<ThanksEntry[]> => {
    const rows = await api.get<Array<{
      researcher_id: string;
      username: string | null;
      accepted: number;
      criticals: number;
      reputation: number;
      earned: number;
    }>>(`/v1/programs/${slug}/thanks`);
    return (rows ?? []).map((r) => ({
      researcherId: r.researcher_id,
      username: r.username ?? "deleted account",
      accepted: r.accepted,
      criticals: r.criticals,
      reputation: r.reputation,
      earnedCents: r.earned,
    }));
  },

  collaborators: async (slug: string): Promise<Collaborator[]> => {
    const rows = await api.get<Array<{
      researcher_id: string;
      username: string | null;
      reports: number;
      last_report_at: string;
    }>>(`/v1/programs/${slug}/collaborators`);
    return (rows ?? []).map((r) => ({
      researcherId: r.researcher_id,
      username: r.username ?? "deleted account",
      reports: r.reports,
      lastReportAt: r.last_report_at,
    }));
  },

  updates: async (slug: string): Promise<ProgramUpdate[]> => {
    const rows = await api.get<Array<{
      id: string;
      title: string;
      body_md: string;
      author_name: string | null;
      created_at: string;
    }>>(`/v1/programs/${slug}/updates`);
    return (rows ?? []).map((r) => ({
      id: r.id,
      title: r.title,
      bodyMd: r.body_md,
      authorName: r.author_name,
      createdAt: r.created_at,
    }));
  },

  postUpdate: (slug: string, title: string, bodyMd: string) =>
    api.post<void>(`/v1/admin/programs/${slug}/updates`, { body: { title, body_md: bodyMd } }),

  myPayouts: async (): Promise<Payout[]> => {
    const res = await api.get<{ items: RawPayout[] }>("/v1/me/payouts");
    return (res.items ?? []).map(mapPayout);
  },
};
