/**
 * Bounty, billing, notification, and settings API wrappers.
 */

import { api } from "@/lib/api";
import type { Paginated } from "@/types";
import type {
  BountyProgram,
  BountyProgramDetail,
  BountyReport,
  BountyReportDetail,
  Payout,
  ReportCreate,
} from "@/types/bounty";
import type {
  Subscription,
  PaymentMethod,
  Invoice,
  PlanId,
  BillingPeriod,
  Notification,
  NotificationPreference,
  WebhookEndpoint,
  SessionInfo,
  ApiKey,
} from "@/types/account";

export const bountyApi = {
  listPrograms: (q?: string) =>
    api.get<Paginated<BountyProgram>>("/v1/programs", { params: { q } }),
  getProgram: (slug: string) => api.get<BountyProgramDetail>(`/v1/programs/${slug}`),
  submitReport: (slug: string, body: ReportCreate) =>
    api.post<BountyReport>(`/v1/programs/${slug}/reports`, { body }),
  myReports: (state?: string) =>
    api.get<Paginated<BountyReport>>("/v1/me/reports", { params: { state } }),
  getReport: (id: string) => api.get<BountyReportDetail>(`/v1/reports/${id}`),
  comment: (id: string, bodyMd: string) =>
    api.post<void>(`/v1/reports/${id}/comments`, { body: { bodyMd } }),
  myPayouts: () => api.get<Payout[]>("/v1/me/payouts"),
};

export const billingApi = {
  getSubscription: () => api.get<Subscription>("/v1/billing/subscription"),
  paymentMethods: () => api.get<PaymentMethod[]>("/v1/billing/payment-methods"),
  invoices: () => api.get<Invoice[]>("/v1/billing/invoices"),
  checkout: (planId: PlanId, period: BillingPeriod, seats?: number) =>
    api.post<{ checkoutUrl: string }>("/v1/billing/checkout", { body: { planId, period, seats } }),
  cancelSubscription: () => api.post<void>("/v1/billing/subscription/cancel"),
  resumeSubscription: () => api.post<void>("/v1/billing/subscription/resume"),
  setDefaultMethod: (id: string) => api.post<void>(`/v1/billing/payment-methods/${id}/default`),
  removeMethod: (id: string) => api.delete<void>(`/v1/billing/payment-methods/${id}`),
};

export const notificationApi = {
  list: (unreadOnly?: boolean) =>
    api.get<Paginated<Notification>>("/v1/me/notifications", { params: { unreadOnly } }),
  markRead: (id: string) => api.post<void>(`/v1/me/notifications/${id}/read`),
  markAllRead: () => api.post<void>("/v1/me/notifications/read-all"),
  preferences: () => api.get<NotificationPreference[]>("/v1/me/preferences"),
  updatePreference: (category: string, channel: string, enabled: boolean) =>
    api.patch<void>("/v1/me/preferences", { body: { category, channel, enabled } }),
  webhooks: () => api.get<WebhookEndpoint[]>("/v1/me/webhooks"),
  createWebhook: (url: string, events: string[]) =>
    api.post<WebhookEndpoint>("/v1/me/webhooks", { body: { url, events } }),
  deleteWebhook: (id: string) => api.delete<void>(`/v1/me/webhooks/${id}`),
};

export const settingsApi = {
  sessions: () => api.get<SessionInfo[]>("/v1/me/sessions"),
  revokeSession: (id: string) => api.delete<void>(`/v1/me/sessions/${id}`),
  apiKeys: () => api.get<ApiKey[]>("/v1/me/api-keys"),
  createApiKey: (name: string, scopes: string[]) =>
    api.post<{ key: string; apiKey: ApiKey }>("/v1/me/api-keys", { body: { name, scopes } }),
  revokeApiKey: (id: string) => api.delete<void>(`/v1/me/api-keys/${id}`),
  updateProfile: (body: { username?: string; country?: string; bio?: string }) =>
    api.patch<void>("/v1/me", { body }),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<void>("/v1/auth/change-password", { body: { currentPassword, newPassword } }),
  getVpnConfig: (region?: string) =>
    api.get<{ filename: string; config: string; region: string }>("/v1/vpn/config", { params: { region } }),
};
