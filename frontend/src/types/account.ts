/**
 * Billing, notification, and settings types. Mirror payment-svc +
 * notification-svc + user-svc/auth-svc APIs.
 */

/* --------------------------------- billing -------------------------------- */
export type PlanId = "free" | "pro" | "team";
export type BillingPeriod = "monthly" | "annual";

export interface Subscription {
  planId: PlanId;
  status: "active" | "trialing" | "past_due" | "canceled" | "none";
  period: BillingPeriod;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  seats: number;
}

export interface PaymentMethod {
  id: string;
  brand: string; // visa, mastercard, amex
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
}

export interface Invoice {
  id: string;
  number: string;
  amountCents: number;
  currency: string;
  status: "paid" | "open" | "void" | "uncollectible";
  periodStart: string;
  periodEnd: string;
  pdfUrl: string | null;
  createdAt: string;
}

/* ------------------------------ notifications ----------------------------- */
export type NotificationType =
  | "machine_owned"
  | "ctf_starting"
  | "forum_reply"
  | "report_update"
  | "payout"
  | "rank_change"
  | "system";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

export interface NotificationPreference {
  category: string;
  label: string;
  description: string;
  email: boolean;
  push: boolean;
  inApp: boolean;
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: string;
  lastDeliveryAt: string | null;
  lastDeliveryStatus: "success" | "failed" | null;
}

/* -------------------------------- settings -------------------------------- */
export interface SessionInfo {
  id: string;
  device: string;
  browser: string;
  ipAddress: string;
  location: string | null;
  current: boolean;
  lastActiveAt: string;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string; // shown; full key only on create
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}
