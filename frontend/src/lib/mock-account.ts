/**
 * Mock seed data for bounty, billing, notifications, settings.
 */

import type { Paginated } from "@/types";
import type {
  Subscription,
  PaymentMethod,
  Invoice,
  Notification,
  NotificationPreference,
  WebhookEndpoint,
  SessionInfo,
  ApiKey,
} from "@/types/account";


/* --------------------------------- billing -------------------------------- */
export const MOCK_SUBSCRIPTION: Subscription = {
  planId: "pro",
  status: "active",
  period: "annual",
  currentPeriodEnd: new Date(Date.now() + 86400_000 * 280).toISOString(),
  cancelAtPeriodEnd: false,
  seats: 1,
};

export const MOCK_PAYMENT_METHODS: PaymentMethod[] = [
  { id: "pm1", brand: "visa", last4: "4242", expMonth: 8, expYear: 2028, isDefault: true },
];

export const MOCK_INVOICES: Invoice[] = [
  { id: "in1", number: "OFFCON-2026-0042", amountCents: 13200, currency: "USD", status: "paid", periodStart: "2026-01-15", periodEnd: "2027-01-15", pdfUrl: "#", createdAt: "2026-01-15" },
  { id: "in2", number: "OFFCON-2025-0318", amountCents: 1400, currency: "USD", status: "paid", periodStart: "2025-12-15", periodEnd: "2026-01-15", pdfUrl: "#", createdAt: "2025-12-15" },
  { id: "in3", number: "OFFCON-2025-0291", amountCents: 1400, currency: "USD", status: "paid", periodStart: "2025-11-15", periodEnd: "2025-12-15", pdfUrl: "#", createdAt: "2025-11-15" },
];

/* ------------------------------ notifications ----------------------------- */
export const MOCK_NOTIFICATIONS: Notification[] = [
  { id: "n1", type: "report_update", title: "Your report ACM-1042 is now triaging", body: "The ACME triage team has reproduced your stored XSS report.", link: "/bounty/reports/r1", read: false, createdAt: new Date(Date.now() - 3600_000 * 2).toISOString() },
  { id: "n2", type: "payout", title: "Payout sent: $2,500", body: "Your bounty for CLD-0871 has been paid out.", link: "/bounty/reports/r3", read: false, createdAt: new Date(Date.now() - 3600_000 * 6).toISOString() },
  { id: "n3", type: "ctf_starting", title: "Winter Clash 2026 starts in 1 hour", body: "Your registered CTF event is about to begin. Get ready!", link: "/ctf/winter-clash-2026", read: false, createdAt: new Date(Date.now() - 3600_000 * 12).toISOString() },
  { id: "n4", type: "forum_reply", title: "zer0Kelvin replied to your thread", body: "On 'Sentinel — stuck on privesc after www-data shell'", link: "/forum/thread/th1", read: true, createdAt: new Date(Date.now() - 86400_000).toISOString() },
  { id: "n5", type: "rank_change", title: "You climbed to rank #842", body: "Up 1,204 spots this week. Keep it up!", link: "/leaderboard", read: true, createdAt: new Date(Date.now() - 86400_000 * 2).toISOString() },
  { id: "n6", type: "machine_owned", title: "You rooted Sentinel", body: "+20 points. Nice work!", link: "/machines/sentinel", read: true, createdAt: new Date(Date.now() - 86400_000 * 3).toISOString() },
];

export function mockNotifications(): Paginated<Notification> {
  return { items: MOCK_NOTIFICATIONS, meta: { total: MOCK_NOTIFICATIONS.length, limit: 25, offset: 0, hasMore: false } };
}

export const MOCK_PREFERENCES: NotificationPreference[] = [
  { category: "machines", label: "Machine activity", description: "Owns, first bloods, and machine releases", email: true, push: true, inApp: true },
  { category: "ctf", label: "CTF events", description: "Event reminders and results", email: true, push: false, inApp: true },
  { category: "forum", label: "Forum replies", description: "Replies to your threads and mentions", email: false, push: true, inApp: true },
  { category: "bounty", label: "Bug bounty", description: "Report status changes and payouts", email: true, push: true, inApp: true },
  { category: "ranking", label: "Ranking", description: "Rank changes and tier promotions", email: false, push: false, inApp: true },
  { category: "product", label: "Product & news", description: "New features and announcements", email: true, push: false, inApp: false },
];

export const MOCK_WEBHOOKS: WebhookEndpoint[] = [
  { id: "wh1", url: "https://hooks.example.com/offcon", events: ["report.updated", "payout.paid"], active: true, createdAt: "2026-03-01", lastDeliveryAt: new Date(Date.now() - 3600_000 * 4).toISOString(), lastDeliveryStatus: "success" },
];

/* -------------------------------- settings -------------------------------- */
export const MOCK_SESSIONS: SessionInfo[] = [
  { id: "s1", device: "MacBook Pro", browser: "Chrome 124", ipAddress: "203.0.113.42", location: "Lahore, PK", current: true, lastActiveAt: new Date().toISOString() },
  { id: "s2", device: "iPhone 15", browser: "Safari", ipAddress: "203.0.113.88", location: "Lahore, PK", current: false, lastActiveAt: new Date(Date.now() - 3600_000 * 18).toISOString() },
  { id: "s3", device: "Linux Workstation", browser: "Firefox 125", ipAddress: "198.51.100.7", location: "Karachi, PK", current: false, lastActiveAt: new Date(Date.now() - 86400_000 * 3).toISOString() },
];

export const MOCK_API_KEYS: ApiKey[] = [
  { id: "k1", name: "CI pipeline", prefix: "offcon_live_8fa2", scopes: ["machines:read", "flag:submit"], createdAt: "2026-02-10", lastUsedAt: new Date(Date.now() - 3600_000 * 30).toISOString(), expiresAt: null },
];

export const MOCK_VPN = {
  filename: "offcon-eu-west.conf",
  region: "eu-west",
  config: `[Interface]
PrivateKey = <your-private-key>
Address = 10.10.14.99/24
DNS = 10.10.0.1

[Peer]
PublicKey = kQ8f...serverpubkey...x2Y=
Endpoint = vpn-eu-west.offensiveconditions.org:51820
AllowedIPs = 10.10.0.0/16
PersistentKeepalive = 25`,
};
