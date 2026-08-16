"use client";

/**
 * Hooks for bounty, billing, notifications, and settings. Live API with mock
 * fallback (same pattern as the other hook modules).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { bountyApi, billingApi, notificationApi, settingsApi } from "@/lib/account-api";
import {
  mockPrograms,
  mockProgramDetail,
  mockReports,
  mockReportDetail,
  MOCK_PAYOUTS,
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
export function usePrograms(q?: string) {
  return useQuery({ queryKey: ["programs", q], queryFn: () => withMock(() => bountyApi.listPrograms(q), mockPrograms) });
}
export function useProgram(slug: string) {
  return useQuery({ queryKey: ["program", slug], queryFn: () => withMock(() => bountyApi.getProgram(slug), () => mockProgramDetail(slug)), enabled: Boolean(slug) });
}
export function useMyReports(state?: string) {
  return useQuery({ queryKey: ["my-reports", state], queryFn: () => withMock(() => bountyApi.myReports(state), mockReports) });
}
export function useReport(id: string) {
  return useQuery({ queryKey: ["report", id], queryFn: () => withMock(() => bountyApi.getReport(id), () => mockReportDetail(id)), enabled: Boolean(id) });
}
export function useMyPayouts() {
  return useQuery({ queryKey: ["payouts"], queryFn: () => withMock(() => bountyApi.myPayouts(), () => MOCK_PAYOUTS) });
}
export function useSubmitReport(slug: string) {
  return useMutation({
    mutationFn: (body: ReportCreate) => bountyApi.submitReport(slug, body),
    onError: () => toast.error("Couldn't submit the report. Try again."),
  });
}
export function useReportComment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (bodyMd: string) => bountyApi.comment(id, bodyMd),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["report", id] });
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
