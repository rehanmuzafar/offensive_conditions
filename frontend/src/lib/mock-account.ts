/**
 * Mock seed data for bounty, billing, notifications, settings.
 */

import type { Paginated } from "@/types";
import type {
  BountyProgram,
  BountyProgramDetail,
  BountyReport,
  BountyReportDetail,
  Payout,
} from "@/types/bounty";
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

const AUTHOR = { username: "you", avatarUrl: null, tier: "pro_hacker" as const };
const TRIAGER = { username: "triage-team", avatarUrl: null, tier: "elite_operator" as const };

/* --------------------------------- bounty --------------------------------- */
export const MOCK_PROGRAMS: BountyProgram[] = [
  { id: "p1", slug: "acme-corp", name: "ACME Corporation", orgName: "ACME Corp", status: "published", visibility: "public", currency: "USD", minRewardCents: 5000, maxRewardCents: 1000000, totalReports: 1240, totalPaidCents: 48500000, responseSlaHours: 24, safeHarbor: true, bannerColor: "#7C3AED", publishedAt: "2026-01-10", tags: ["web", "api", "mobile"] },
  { id: "p2", slug: "fintech-secure", name: "FinTech Secure", orgName: "FinTech Inc", status: "published", visibility: "public", currency: "USD", minRewardCents: 25000, maxRewardCents: 5000000, totalReports: 680, totalPaidCents: 92000000, responseSlaHours: 8, safeHarbor: true, bannerColor: "#2563EB", publishedAt: "2026-02-01", tags: ["payments", "api"] },
  { id: "p3", slug: "cloudbase", name: "CloudBase Platform", orgName: "CloudBase", status: "published", visibility: "public", currency: "USD", minRewardCents: 10000, maxRewardCents: 2000000, totalReports: 920, totalPaidCents: 61000000, responseSlaHours: 48, safeHarbor: true, bannerColor: "#6D28D9", publishedAt: "2025-11-20", tags: ["cloud", "infra"] },
  { id: "p4", slug: "shopflow", name: "ShopFlow Commerce", orgName: "ShopFlow", status: "published", visibility: "public", currency: "USD", minRewardCents: 5000, maxRewardCents: 800000, totalReports: 540, totalPaidCents: 23000000, responseSlaHours: 72, safeHarbor: true, bannerColor: "#1D4ED8", publishedAt: "2026-03-05", tags: ["ecommerce", "web"] },
];

export function mockPrograms(): Paginated<BountyProgram> {
  return { items: MOCK_PROGRAMS, meta: { total: MOCK_PROGRAMS.length, limit: 24, offset: 0, hasMore: false } };
}

export function mockProgramDetail(slug: string): BountyProgramDetail {
  const base = MOCK_PROGRAMS.find((p) => p.slug === slug) ?? MOCK_PROGRAMS[0]!;
  return {
    ...base,
    description: `${base.orgName} runs a public bug bounty program covering our web, API, and mobile surface. We welcome security researchers and reward valid, in-scope findings based on severity and impact.`,
    policy: "Test only against in-scope assets. No automated scanning that degrades service. No social engineering or physical attacks. Report responsibly and give us reasonable time to remediate before any disclosure. Safe harbor applies to good-faith research.",
    inScopeSummary: "All assets under the listed domains, our public API, and the official mobile apps.",
    outOfScopeSummary: "Third-party services we don't control. Denial-of-service. Social engineering. Physical security. Recently disclosed (<30 day) CVEs in third-party software.",
    scope: [
      { assetType: "domain", assetIdentifier: `${base.slug}.example`, severityMax: "critical", inScope: true, notes: "Primary web application" },
      { assetType: "wildcard", assetIdentifier: `*.${base.slug}.example`, severityMax: "critical", inScope: true, notes: "All subdomains" },
      { assetType: "api", assetIdentifier: `api.${base.slug}.example`, severityMax: "critical", inScope: true, notes: "Public REST API" },
      { assetType: "mobile_app", assetIdentifier: `com.${base.slug}.app`, severityMax: "high", inScope: true, notes: "iOS + Android" },
      { assetType: "domain", assetIdentifier: `blog.${base.slug}.example`, severityMax: "low", inScope: false, notes: "Marketing blog — out of scope" },
    ],
    rewards: [
      { severity: "critical", minCents: 500000, maxCents: base.maxRewardCents, currency: base.currency },
      { severity: "high", minCents: 100000, maxCents: 300000, currency: base.currency },
      { severity: "medium", minCents: 30000, maxCents: 100000, currency: base.currency },
      { severity: "low", minCents: base.minRewardCents, maxCents: 25000, currency: base.currency },
    ],
  };
}

export const MOCK_REPORTS: BountyReport[] = [
  { id: "r1", shortId: "ACM-1042", programSlug: "acme-corp", programName: "ACME Corporation", title: "Stored XSS in product review form", severity: "high", cvssScore: 8.2, state: "triaging", bountyCents: 0, bountyCurrency: null, assetIdentifier: "shop.acme.example", createdAt: new Date(Date.now() - 86400_000 * 2).toISOString(), updatedAt: new Date(Date.now() - 3600_000 * 5).toISOString() },
  { id: "r2", shortId: "FIN-0318", programSlug: "fintech-secure", programName: "FinTech Secure", title: "IDOR allows reading other users' transactions", severity: "critical", cvssScore: 9.1, state: "accepted", bountyCents: 0, bountyCurrency: null, assetIdentifier: "api.fintech-secure.example", createdAt: new Date(Date.now() - 86400_000 * 5).toISOString(), updatedAt: new Date(Date.now() - 86400_000 * 1).toISOString() },
  { id: "r3", shortId: "CLD-0871", programSlug: "cloudbase", programName: "CloudBase Platform", title: "SSRF in webhook configuration", severity: "high", cvssScore: 7.7, state: "paid", bountyCents: 250000, bountyCurrency: "USD", assetIdentifier: "api.cloudbase.example", createdAt: new Date(Date.now() - 86400_000 * 14).toISOString(), updatedAt: new Date(Date.now() - 86400_000 * 7).toISOString() },
  { id: "r4", shortId: "ACM-0987", programSlug: "acme-corp", programName: "ACME Corporation", title: "Open redirect on login callback", severity: "low", cvssScore: 4.3, state: "resolved", bountyCents: 15000, bountyCurrency: "USD", assetIdentifier: "acme.example", createdAt: new Date(Date.now() - 86400_000 * 20).toISOString(), updatedAt: new Date(Date.now() - 86400_000 * 12).toISOString() },
  { id: "r5", shortId: "SHP-0210", programSlug: "shopflow", programName: "ShopFlow Commerce", title: "Rate limit bypass on coupon endpoint", severity: "medium", cvssScore: 5.8, state: "duplicate", bountyCents: 0, bountyCurrency: null, assetIdentifier: "api.shopflow.example", createdAt: new Date(Date.now() - 86400_000 * 25).toISOString(), updatedAt: new Date(Date.now() - 86400_000 * 22).toISOString() },
];

export function mockReports(): Paginated<BountyReport> {
  return { items: MOCK_REPORTS, meta: { total: MOCK_REPORTS.length, limit: 25, offset: 0, hasMore: false } };
}

export function mockReportDetail(id: string): BountyReportDetail {
  const base = MOCK_REPORTS.find((r) => r.id === id) ?? MOCK_REPORTS[0]!;
  return {
    ...base,
    descriptionMd: "## Summary\n\nThe affected endpoint does not properly sanitize user input, allowing an attacker to inject a payload that is later rendered in another user's context.\n\n## Details\n\nThe input is stored without encoding and reflected back when the page is viewed by other users.",
    reproductionSteps: "1. Navigate to the affected page\n2. Submit the payload `<script>alert(document.domain)</script>`\n3. Open the page as a different user\n4. Observe the script executes",
    impact: "An attacker can execute arbitrary JavaScript in the context of other users, enabling session theft, credential harvesting, and account takeover.",
    vrtCategory: "server_security_misconfiguration.xss.stored",
    cvssVector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:H/I:H/A:N",
    comments: [
      { id: "c1", author: AUTHOR, bodyMd: "Initial report submitted with full PoC attached.", visibility: "public", isStateChange: false, createdAt: base.createdAt },
      { id: "c2", author: TRIAGER, bodyMd: "Thanks for the detailed report! We've reproduced the issue and are escalating to the engineering team for triage.", visibility: "public", isStateChange: false, createdAt: new Date(Date.now() - 3600_000 * 8).toISOString() },
    ],
    transitions: [
      { id: "t1", fromState: null, toState: "submitted", actorName: "you", reason: null, at: base.createdAt },
      { id: "t2", fromState: "submitted", toState: "triaging", actorName: "triage-team", reason: "Reproduced, escalating", at: new Date(Date.now() - 3600_000 * 8).toISOString() },
    ],
  };
}

export const MOCK_PAYOUTS: Payout[] = [
  { id: "po1", reportShortId: "CLD-0871", programName: "CloudBase Platform", amountCents: 250000, currency: "USD", state: "paid", requestedAt: new Date(Date.now() - 86400_000 * 8).toISOString(), paidAt: new Date(Date.now() - 86400_000 * 7).toISOString() },
  { id: "po2", reportShortId: "ACM-0987", programName: "ACME Corporation", amountCents: 15000, currency: "USD", state: "paid", requestedAt: new Date(Date.now() - 86400_000 * 13).toISOString(), paidAt: new Date(Date.now() - 86400_000 * 12).toISOString() },
  { id: "po3", reportShortId: "FIN-0318", programName: "FinTech Secure", amountCents: 800000, currency: "USD", state: "processing", requestedAt: new Date(Date.now() - 3600_000 * 20).toISOString(), paidAt: null },
];

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
