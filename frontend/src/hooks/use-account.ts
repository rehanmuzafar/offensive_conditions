"use client";

/**
 * Hooks for bounty, billing, notifications, and settings. Live API with mock
 * fallback (same pattern as the other hook modules).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { bountyApi, billingApi, notificationApi, settingsApi } from "@/lib/account-api";
import {
  MOCK_SUBSCRIPTION,
  MOCK_PAYMENT_METHODS,
  MOCK_INVOICES,
  mockNotifications,
  MOCK_PREFERENCES,
  MOCK_WEBHOOKS,
  MOCK_SESSIONS,
  MOCK_API_KEYS,
  MOCK_VPN,
} from "@/lib/mock-account";
import type { ReportCreate } from "@/types/bounty";
import type { PlanId, BillingPeriod } from "@/types/account";

/**
 * Live API only — the mock fallback is intentionally disabled.
 *
 * Serving seed data when a request fails hides backend outages behind
 * plausible-looking content, which on a scoring platform means users could see
 * fabricated machines or standings. Errors now propagate to React Query so the
 * UI shows a real error state. `fallback` is kept in the signature so the call
 * sites stay unchanged, but it is never invoked.
 */
async function withMock<T>(fn: () => Promise<T>, _fallback: () => T): Promise<T> {
  return fn();
}

/* --------------------------------- bounty --------------------------------- */
export function usePrograms(
  params: { q?: string; assetType?: string; hasBounty?: boolean; limit?: number } = {},
) {
  return useQuery({
    queryKey: ["programs", params],
    queryFn: () => bountyApi.listPrograms(params),
  });
}
export function useProgram(slug: string) {
  return useQuery({ queryKey: ["program", slug], queryFn: () => bountyApi.getProgram(slug), enabled: Boolean(slug) });
}
export function useMyReports(state?: string) {
  return useQuery({ queryKey: ["my-reports", state], queryFn: () => bountyApi.myReports(state) });
}
export function useReport(id: string) {
  return useQuery({ queryKey: ["report", id], queryFn: () => bountyApi.getReport(id), enabled: Boolean(id) });
}

/**
 * Comments and history are separate endpoints, not fields on the report.
 * They were read off the report object, which never carried them — so both
 * lists rendered empty no matter what was in the database.
 */
export function useReportComments(id: string) {
  return useQuery({ queryKey: ["report-comments", id], queryFn: () => bountyApi.comments(id), enabled: Boolean(id) });
}
export function useReportTimeline(id: string) {
  return useQuery({ queryKey: ["report-timeline", id], queryFn: () => bountyApi.timeline(id), enabled: Boolean(id) });
}

export function useHacktivity(
  params: { program?: string; severity?: string; q?: string; limit?: number } = {},
) {
  return useQuery({
    queryKey: ["hacktivity", params],
    queryFn: () => bountyApi.hacktivity(params),
  });
}
export function useWeaknesses() {
  return useQuery({ queryKey: ["weaknesses"], queryFn: () => bountyApi.weaknesses() });
}

export function useProgramThanks(slug: string) {
  return useQuery({
    queryKey: ["program-thanks", slug],
    queryFn: () => bountyApi.thanks(slug),
    enabled: Boolean(slug),
  });
}
export function useProgramCollaborators(slug: string) {
  return useQuery({
    queryKey: ["program-collaborators", slug],
    queryFn: () => bountyApi.collaborators(slug),
    enabled: Boolean(slug),
  });
}
export function useProgramUpdates(slug: string) {
  return useQuery({
    queryKey: ["program-updates", slug],
    queryFn: () => bountyApi.updates(slug),
    enabled: Boolean(slug),
  });
}

export function useMyPayouts() {
  return useQuery({ queryKey: ["payouts"], queryFn: () => bountyApi.myPayouts() });
}
export function useSubmitReport(slug: string) {
  return useMutation({
    mutationFn: (body: ReportCreate) => bountyApi.submitReport(slug, body),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Couldn't submit the report. Try again."),
  });
}
export function useReportComment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ bodyMd, visibility }: { bodyMd: string; visibility?: "public" | "internal" }) =>
      bountyApi.comment(id, bodyMd, visibility),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["report-comments", id] });
      toast.success("Comment posted");
    },
    onError: () => toast.error("Couldn't post your comment."),
  });
}

/* --------------------------------- billing -------------------------------- */
export function useSubscription() {
  return useQuery({ queryKey: ["subscription"], queryFn: () => withMock(() => billingApi.getSubscription(), () => MOCK_SUBSCRIPTION) });
}
export function usePaymentMethods() {
  return useQuery({ queryKey: ["payment-methods"], queryFn: () => withMock(() => billingApi.paymentMethods(), () => MOCK_PAYMENT_METHODS) });
}
export function useInvoices() {
  return useQuery({ queryKey: ["invoices"], queryFn: () => withMock(() => billingApi.invoices(), () => MOCK_INVOICES) });
}
export function useCheckout() {
  return useMutation({
    mutationFn: ({ planId, period, seats }: { planId: PlanId; period: BillingPeriod; seats?: number }) =>
      billingApi.checkout(planId, period, seats),
    onSuccess: ({ checkoutUrl }) => {
      window.location.href = checkoutUrl;
    },
    onError: () => toast.error("Couldn't start checkout. Try again."),
  });
}
export function useCancelSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => billingApi.cancelSubscription(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["subscription"] });
      toast.success("Subscription will cancel at period end.");
    },
    onError: () => toast.error("Couldn't cancel. Try again."),
  });
}

/* ------------------------------ notifications ----------------------------- */
export function useNotifications(unreadOnly?: boolean) {
  return useQuery({
    queryKey: ["notifications", unreadOnly],
    queryFn: () => withMock(() => notificationApi.list(unreadOnly), mockNotifications),
  });
}
export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => notificationApi.markAllRead(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
    onError: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}
export function usePreferences() {
  return useQuery({ queryKey: ["preferences"], queryFn: () => withMock(() => notificationApi.preferences(), () => MOCK_PREFERENCES) });
}
export function useWebhooks() {
  return useQuery({ queryKey: ["webhooks"], queryFn: () => withMock(() => notificationApi.webhooks(), () => MOCK_WEBHOOKS) });
}

/* -------------------------------- settings -------------------------------- */
export function useSessions() {
  return useQuery({ queryKey: ["sessions"], queryFn: () => withMock(() => settingsApi.sessions(), () => MOCK_SESSIONS) });
}
export function useApiKeys() {
  return useQuery({ queryKey: ["api-keys"], queryFn: () => withMock(() => settingsApi.apiKeys(), () => MOCK_API_KEYS) });
}
export function useVpnConfig(region?: string) {
  return useQuery({ queryKey: ["vpn", region], queryFn: () => withMock(() => settingsApi.getVpnConfig(region), () => MOCK_VPN) });
}
export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => settingsApi.revokeSession(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sessions"] });
      toast.success("Session revoked");
    },
    onError: () => toast.error("Couldn't revoke session."),
  });
}
export function useChangePassword() {
  return useMutation({
    mutationFn: ({ current, next }: { current: string; next: string }) =>
      settingsApi.changePassword(current, next),
    onSuccess: () => toast.success("Password updated"),
    onError: () => toast.error("Couldn't change password. Check your current password."),
  });
}
