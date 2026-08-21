/**
 * Admin API wrappers — privileged endpoints (gated server-side by role; the
 * gateway enforces the admin authz policy from Phase 14).
 */

import { api } from "@/lib/api";
import { contentApi } from "@/lib/content-api";
import { searchUsers } from "@/lib/teams-api";
import type { Paginated } from "@/types";
import type {
  AdminOverview,
  AdminMachine,
  AdminReportQueue,
  AdminUser,
  FlaggedContent,
  Broadcast,
} from "@/types/admin";
import type { ReportState, Severity } from "@/types/bounty";

/** Wire shape of a queue row — snake_case, as bounty-svc sends it. */
interface RawQueueItem {
  id: string;
  short_id: string;
  title: string;
  state: ReportState;
  severity: Severity;
  program_name: string;
  program_slug: string;
  researcher_id: string;
  researcher_name: string | null;
  triager_id: string | null;
  triager_name: string | null;
  bounty_cents: number;
  bounty_currency: string | null;
  age_hours: number;
  sla_breached: boolean;
  created_at: string;
  triaged_at: string | null;
}

interface RawAdminProgram {
  id: string;
  slug: string;
  name: string;
  status: string;
  visibility: string;
  currency: string;
  total_reports: number;
  total_payouts_cents: number;
  min_reward_cents: number | null;
  max_reward_cents: number | null;
}

export interface ProgramCreateInput {
  slug: string;
  name: string;
  description: string;
  policy: string;
  visibility: "public" | "invite_only" | "private";
  currency: string;
  minRewardCents: number | null;
  maxRewardCents: number | null;
  disclosurePolicy: "coordinated" | "full" | "none";
  responseSlaHours: number;
  triageSlaHours: number;
  resolutionSlaDays: number;
  inScopeSummary: string;
  outOfScopeSummary: string;
  safeHarbor: boolean;
  scope: Array<{
    assetType: string;
    assetIdentifier: string;
    severityMax: Severity;
    inScope: boolean;
    notes: string;
  }>;
  rewards: Array<{ severity: Severity; minCents: number; maxCents: number; currency: string }>;
}

export function mapQueueItem(r: RawQueueItem): AdminReportQueue {
  return {
    id: r.id,
    shortId: r.short_id,
    programName: r.program_name,
    programSlug: r.program_slug,
    title: r.title,
    severity: r.severity,
    state: r.state,
    reporter: r.researcher_name,
    assignedTo: r.triager_name,
    ageHours: Math.round(r.age_hours),
    slaBreached: r.sla_breached,
    bountyCents: r.bounty_cents,
    bountyCurrency: r.bounty_currency,
  };
}

export const adminApi = {
  overview: () => api.get<AdminOverview>("/v1/admin/overview"),

  /* Machines.
   *
   * `/v1/admin/machines` is not a route on any service — the whole admin
   * namespace proxies to the orchestrator, which serves only `/admin/capacity`
   * and a force-kill. The list 404'd, so the page rendered an empty table and
   * looked like the feature was broken rather than absent.
   *
   * content-svc owns machines and already returns drafts and retired units to
   * staff (`include_unpublished` keys off the caller's claims), so the admin
   * list is that list, seen with an admin's token. */
  machines: async (q?: string): Promise<Paginated<AdminMachine>> => {
    const page = await contentApi.listMachines({ q, limit: 100 });
    return {
      items: page.items.map(
        (m): AdminMachine => ({
          id: m.id,
          slug: m.slug,
          name: m.name,
          os: m.os,
          difficulty: m.difficulty,
          status: m.isActive ? "active" : "retired",
          points: m.points,
          userOwns: m.userOwns,
          rootOwns: m.rootOwns,
          maker: m.makers?.[0]?.username ?? "—",
          releasedAt: m.releasedAt ?? null,
          isFree: m.isFree,
        }),
      ),
      meta: page.meta,
    };
  },
  /**
   * Create a machine.
   *
   * `delivery` decides which of the other fields matter, and content-svc
   * refuses a machine that is missing the one thing its kind needs — a spawn
   * with no image, a static host with no address, a download with no file.
   */
  createMachine: (body: {
    name: string;
    slug: string;
    description?: string | null;
    os: string;
    difficulty: string;
    delivery: "spawn" | "static_host" | "download";
    backend?: "container" | "vm";
    image_ref?: string | null;
    image_version?: string | null;
    static_host?: string | null;
    download_url?: string | null;
    download_sha256?: string | null;
    download_size_bytes?: number | null;
    download_format?: string | null;
    base_user_points?: number;
    base_root_points?: number;
    required_tier?: "free" | "vip" | "vip_plus";
  }) => api.post<{ id: string; slug: string }>("/v1/machines", { body }),

  /** content-svc models this as two verbs rather than a status field. */
  setMachineStatus: (id: string, status: string) =>
    api.post<void>(`/v1/machines/${id}/${status === "active" ? "publish" : "retire"}`),

  /* Bounty triage.
   *
   * These used to point at `/transition`, `/assign` and a `POST` body of
   * `{toState}` — none of which bounty-svc has. It models triage as one verb
   * per decision (accept / reject / duplicate / resolve), because each carries
   * different required data: a rejection needs a reason, an acceptance needs a
   * severity, a duplicate needs the report it duplicates. A single
   * `transition(state)` cannot express that.
   */
  reportQueue: (params: { state?: string; severity?: string; program?: string } = {}) =>
    api.get<{ items: RawQueueItem[]; meta: unknown }>("/v1/admin/reports", { params }),

  /* Bounty programs.
   *
   * Nothing on the platform could create one, so the whole bug bounty section
   * had no way to ever hold content — the researcher-facing pages were reading
   * an endpoint that would always return an empty list.
   */
  listProgramsAdmin: () => api.get<{ items: RawAdminProgram[] }>("/v1/programs"),

  createProgram: (body: ProgramCreateInput) =>
    api.post<{ id: string; slug: string }>("/v1/admin/programs", {
      body: {
        slug: body.slug,
        name: body.name,
        description: body.description,
        policy: body.policy,
        visibility: body.visibility,
        currency: body.currency,
        min_reward_cents: body.minRewardCents,
        max_reward_cents: body.maxRewardCents,
        disclosure_policy: body.disclosurePolicy,
        response_sla_hours: body.responseSlaHours,
        triage_sla_hours: body.triageSlaHours,
        resolution_sla_days: body.resolutionSlaDays,
        in_scope_summary: body.inScopeSummary || null,
        out_of_scope_summary: body.outOfScopeSummary || null,
        safe_harbor: body.safeHarbor,
        scope: body.scope.map((s) => ({
          asset_type: s.assetType,
          asset_identifier: s.assetIdentifier,
          severity_max: s.severityMax,
          in_scope: s.inScope,
          notes: s.notes || null,
        })),
        rewards: body.rewards.map((r) => ({
          severity: r.severity,
          min_cents: r.minCents,
          max_cents: r.maxCents,
          currency: r.currency,
        })),
      },
    }),

  /** draft -> published -> paused/closed. Each is its own verb in bounty-svc. */
  setProgramStatus: (slug: string, action: "publish" | "pause" | "close") =>
    api.post<void>(`/v1/admin/programs/${slug}/${action}`),

  /** Claim a report. Must happen before accept/reject — see the state machine. */
  startTriage: (id: string) => api.post<void>(`/v1/admin/reports/${id}/triage`),

  acceptReport: (
    id: string,
    body: { severity: Severity; cvss_vector?: string | null; cvss_score?: number | null; internal_notes?: string | null },
  ) => api.post<void>(`/v1/admin/reports/${id}/accept`, { body }),

  rejectReport: (id: string, reason: string) =>
    api.post<void>(`/v1/admin/reports/${id}/reject`, { body: { reason } }),

  duplicateReport: (id: string, duplicateOfId: string, reason?: string) =>
    api.post<void>(`/v1/admin/reports/${id}/duplicate`, {
      body: { duplicate_of_id: duplicateOfId, reason },
    }),

  resolveReport: (id: string, resolutionNote?: string) =>
    api.post<void>(`/v1/admin/reports/${id}/resolve`, {
      body: { resolution_note: resolutionNote },
    }),

  awardBounty: (id: string, amountCents: number, opts?: { currency?: string; initiatePayout?: boolean }) =>
    api.post<{ report_id: string; amount_cents: number; currency: string }>(
      `/v1/admin/reports/${id}/award`,
      {
        body: {
          amount_cents: amountCents,
          currency: opts?.currency ?? "USD",
          initiate_payout: opts?.initiatePayout ?? false,
        },
      },
    ),

  /* Users.
   *
   * Same story as machines: `/v1/admin/users` does not exist. user-svc has no
   * roster endpoint at all — the only way in is `/v1/users/search`, which needs
   * at least two characters. So this is search-driven, and an empty query
   * returns nothing rather than pretending to list everybody.
   *
   * What that search returns is a public profile, so the columns this page was
   * built for — email, roles, status, points, last seen — are not all
   * available. Filling them with placeholders would be inventing an audit
   * surface, so the page shows what exists and says what does not. */
  users: async (q?: string): Promise<Paginated<AdminUser>> => {
    const results = await searchUsers(q ?? "", 50);
    const items = results.map(
      (u): AdminUser => ({
        id: u.user_id,
        username: u.username,
        email: "",
        country: u.country_code || null,
        roles: [],
        status: "active",
        points: 0,
        joinedAt: "",
        lastSeenAt: "",
      }),
    );
    return {
      items,
      meta: { total: items.length, limit: items.length, offset: 0, hasMore: false },
    };
  },
  setUserStatus: (id: string, status: string) =>
    api.post<void>(`/v1/admin/users/${id}/status`, { body: { status } }),
  setUserRoles: (id: string, roles: string[]) =>
    api.post<void>(`/v1/admin/users/${id}/roles`, { body: { roles } }),

  // moderation
  flaggedContent: () => api.get<FlaggedContent[]>("/v1/admin/moderation/flagged"),
  moderate: (id: string, action: "approve" | "remove" | "lock") =>
    api.post<void>(`/v1/admin/moderation/${id}`, { body: { action } }),

  // broadcasts
  broadcasts: () => api.get<Broadcast[]>("/v1/admin/broadcasts"),
  createBroadcast: (body: Omit<Broadcast, "id" | "status" | "sentAt" | "recipientCount">) =>
    api.post<Broadcast>("/v1/admin/broadcasts", { body }),
};
