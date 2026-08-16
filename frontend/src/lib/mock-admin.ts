/**
 * Mock seed data for admin panels.
 */

import type { Paginated } from "@/types";
import type {
  AdminOverview,
  AdminMachine,
  AdminReportQueue,
  AdminUser,
  FlaggedContent,
  Broadcast,
} from "@/types/admin";

export const MOCK_OVERVIEW: AdminOverview = {
  metrics: {
    totalUsers: 128420,
    activeUsers30d: 41200,
    totalMachines: 542,
    activeMachines: 38,
    runningInstances: 1840,
    openReports: 47,
    pendingPayoutsCents: 1240000,
    mrrCents: 8650000,
  },
  trends: {
    signups7d: [820, 940, 1100, 980, 1240, 1380, 1150],
    flagsSubmitted7d: [12400, 13800, 15200, 14100, 16800, 18200, 15900],
  },
  recentSignups: [
    { username: "n00bslayer", country: "pk", at: new Date(Date.now() - 600_000).toISOString() },
    { username: "byteWitch", country: "de", at: new Date(Date.now() - 1800_000).toISOString() },
    { username: "rootcanal", country: "us", at: new Date(Date.now() - 3600_000).toISOString() },
    { username: "0verfl0w", country: "in", at: new Date(Date.now() - 5400_000).toISOString() },
    { username: "shellshock", country: "br", at: new Date(Date.now() - 7200_000).toISOString() },
  ],
  systemHealth: [
    { service: "auth-svc", status: "healthy", latencyMs: 12 },
    { service: "orchestrator", status: "healthy", latencyMs: 28 },
    { service: "scoring-svc", status: "healthy", latencyMs: 15 },
    { service: "ctf-svc", status: "degraded", latencyMs: 142 },
    { service: "payment-svc", status: "healthy", latencyMs: 34 },
    { service: "notification-svc", status: "healthy", latencyMs: 19 },
  ],
};

export const MOCK_ADMIN_MACHINES: AdminMachine[] = [
  { id: "m1", slug: "sentinel", name: "Sentinel", os: "linux", difficulty: "easy", status: "active", points: 20, userOwns: 9240, rootOwns: 7110, maker: "zer0Kelvin", releasedAt: "2026-05-10", isFree: true },
  { id: "m2", slug: "irongate", name: "IronGate", os: "windows", difficulty: "medium", status: "active", points: 30, userOwns: 5120, rootOwns: 3980, maker: "sh4dowByte", releasedAt: "2026-05-03", isFree: false },
  { id: "m5", slug: "warden", name: "Warden", os: "windows", difficulty: "insane", status: "active", points: 50, userOwns: 720, rootOwns: 380, maker: "sh4dowByte", releasedAt: "2026-04-12", isFree: false },
  { id: "m9", slug: "nebula", name: "Nebula", os: "linux", difficulty: "hard", status: "queued", points: 40, userOwns: 0, rootOwns: 0, maker: "nullptr_", releasedAt: null, isFree: false },
  { id: "m10", slug: "vault", name: "Vault", os: "linux", difficulty: "medium", status: "draft", points: 30, userOwns: 0, rootOwns: 0, maker: "ghostshell", releasedAt: null, isFree: false },
  { id: "m7", slug: "relay", name: "Relay", os: "linux", difficulty: "medium", status: "retired", points: 30, userOwns: 3600, rootOwns: 2700, maker: "zer0Kelvin", releasedAt: "2026-02-01", isFree: true },
];

export function mockAdminMachines(): Paginated<AdminMachine> {
  return { items: MOCK_ADMIN_MACHINES, meta: { total: MOCK_ADMIN_MACHINES.length, limit: 50, offset: 0, hasMore: false } };
}

export const MOCK_REPORT_QUEUE: AdminReportQueue[] = [
  { id: "r1", shortId: "ACM-1042", programName: "ACME Corporation", title: "Stored XSS in product review form", severity: "high", state: "triaging", reporter: "you", assignedTo: "triage-team", ageHours: 5, slaBreached: false },
  { id: "rq2", shortId: "FIN-0322", programName: "FinTech Secure", title: "Auth bypass via JWT confusion", severity: "critical", state: "submitted", reporter: "byteWitch", assignedTo: null, ageHours: 14, slaBreached: true },
  { id: "rq3", shortId: "CLD-0890", programName: "CloudBase Platform", title: "RCE in image processing pipeline", severity: "critical", state: "submitted", reporter: "rootcanal", assignedTo: null, ageHours: 2, slaBreached: false },
  { id: "rq4", shortId: "SHP-0215", programName: "ShopFlow Commerce", title: "Price manipulation in cart API", severity: "high", state: "triaging", reporter: "0verfl0w", assignedTo: "triage-team", ageHours: 30, slaBreached: false },
  { id: "rq5", shortId: "ACM-1051", programName: "ACME Corporation", title: "CSRF on account settings", severity: "medium", state: "submitted", reporter: "shellshock", assignedTo: null, ageHours: 8, slaBreached: false },
];

export function mockReportQueue(): Paginated<AdminReportQueue> {
  return { items: MOCK_REPORT_QUEUE, meta: { total: MOCK_REPORT_QUEUE.length, limit: 50, offset: 0, hasMore: false } };
}

export const MOCK_ADMIN_USERS: AdminUser[] = [
  { id: "u1", username: "zer0Kelvin", email: "zer0@example.com", country: "de", roles: ["user", "moderator"], status: "active", points: 142850, joinedAt: "2024-03-10", lastSeenAt: new Date(Date.now() - 600_000).toISOString() },
  { id: "u2", username: "sh4dowByte", email: "shadow@example.com", country: "pk", roles: ["user", "ctf_organizer"], status: "active", points: 138200, joinedAt: "2024-05-22", lastSeenAt: new Date(Date.now() - 3600_000).toISOString() },
  { id: "u3", username: "nullptr_", email: "null@example.com", country: "us", roles: ["user"], status: "active", points: 131940, joinedAt: "2024-07-01", lastSeenAt: new Date(Date.now() - 86400_000).toISOString() },
  { id: "u7", username: "spammer99", email: "spam@example.com", country: null, roles: ["user"], status: "suspended", points: 40, joinedAt: "2026-05-20", lastSeenAt: new Date(Date.now() - 86400_000 * 2).toISOString() },
  { id: "u8", username: "cheater_x", email: "cheat@example.com", country: "ru", roles: ["user"], status: "banned", points: 0, joinedAt: "2026-04-15", lastSeenAt: new Date(Date.now() - 86400_000 * 10).toISOString() },
];

export function mockAdminUsers(): Paginated<AdminUser> {
  return { items: MOCK_ADMIN_USERS, meta: { total: MOCK_ADMIN_USERS.length, limit: 50, offset: 0, hasMore: false } };
}

export const MOCK_FLAGGED: FlaggedContent[] = [
  { id: "f1", kind: "post", title: "Re: Sentinel privesc", author: "spammer99", reason: "Spam / advertising", reportedBy: "ghostshell", reportCount: 4, at: new Date(Date.now() - 3600_000 * 3).toISOString(), excerpt: "Check out my cheap exploit pack at totally-legit-site dot biz, full solutions for all boxes…" },
  { id: "f2", kind: "writeup", title: "Obsidian full solution (LEAKED FLAGS)", author: "cheater_x", reason: "Spoilers / flag leak", reportedBy: "zer0Kelvin", reportCount: 11, at: new Date(Date.now() - 3600_000 * 8).toISOString(), excerpt: "The user flag is OFFCON{...} and root is OFFCON{...}, just submit these directly…" },
  { id: "f3", kind: "thread", title: "Selling OSCP exam answers DM me", author: "spammer99", reason: "Prohibited content", reportedBy: "nullptr_", reportCount: 7, at: new Date(Date.now() - 3600_000 * 18).toISOString(), excerpt: "Guaranteed pass, exam dumps available, serious buyers only…" },
];

export const MOCK_BROADCASTS: Broadcast[] = [
  { id: "b1", title: "Winter Clash 2026 registration open", body: "Our biggest CTF of the season starts Friday. Register your team now!", audience: "all", channel: ["in_app", "email"], status: "sent", scheduledFor: null, sentAt: new Date(Date.now() - 86400_000 * 4).toISOString(), recipientCount: 128420 },
  { id: "b2", title: "Scheduled maintenance this weekend", body: "Lab infrastructure will be briefly unavailable Sunday 02:00–04:00 UTC.", audience: "all", channel: ["in_app"], status: "scheduled", scheduledFor: new Date(Date.now() + 86400_000 * 2).toISOString(), sentAt: null, recipientCount: 0 },
  { id: "b3", title: "New Pro feature: unlimited resets", body: "Pro members can now reset machines without cooldown.", audience: "pro", channel: ["in_app", "email", "push"], status: "sent", scheduledFor: null, sentAt: new Date(Date.now() - 86400_000 * 10).toISOString(), recipientCount: 18200 },
];
