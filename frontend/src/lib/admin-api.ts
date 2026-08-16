/**
 * Admin API wrappers — privileged endpoints (gated server-side by role; the
 * gateway enforces the admin authz policy from Phase 14).
 */

import { api } from "@/lib/api";
import type { Paginated } from "@/types";
import type {
  AdminOverview,
  AdminMachine,
  AdminReportQueue,
  AdminUser,
  FlaggedContent,
  Broadcast,
} from "@/types/admin";
import type { ReportState } from "@/types/bounty";

export const adminApi = {
  overview: () => api.get<AdminOverview>("/v1/admin/overview"),

  // machines
  machines: (q?: string) => api.get<Paginated<AdminMachine>>("/v1/admin/machines", { params: { q } }),
  setMachineStatus: (id: string, status: string) =>
    api.post<void>(`/v1/admin/machines/${id}/status`, { body: { status } }),

  // bounty triage
  reportQueue: (state?: string) =>
    api.get<Paginated<AdminReportQueue>>("/v1/admin/reports", { params: { state } }),
  transitionReport: (id: string, toState: ReportState, reason?: string) =>
    api.post<void>(`/v1/admin/reports/${id}/transition`, { body: { toState, reason } }),
  awardBounty: (id: string, amountCents: number) =>
    api.post<void>(`/v1/admin/reports/${id}/award`, { body: { amountCents } }),
  assignReport: (id: string, assignee: string) =>
    api.post<void>(`/v1/admin/reports/${id}/assign`, { body: { assignee } }),

  // users
  users: (q?: string) => api.get<Paginated<AdminUser>>("/v1/admin/users", { params: { q } }),
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
