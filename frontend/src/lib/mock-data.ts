/**
 * Mock seed data — used as a fallback so the UI renders fully during the
 * "build everything, then wire" workflow. The hooks try the live API first and
 * fall back to these when the gateway/services aren't reachable yet.
 *
 * When the backend is live, these are simply never used.
 */

import type { Paginated } from "@/types";
import type { Machine, MachineDetail, Instance, DashboardSummary, Track, TrackDetail } from "@/types/content";
import type { LeaderRow, Season, HallOfFameEntry } from "@/types/leaderboard";

const MAKERS = [
  { username: "zer0Kelvin", avatarUrl: null },
  { username: "sh4dowByte", avatarUrl: null },
  { username: "nullptr_", avatarUrl: null },
];

export const MOCK_MACHINES: Machine[] = [
  { delivery: "spawn", staticHost: null, downloadUrl: null, downloadSha256: null, downloadSizeBytes: null, downloadFormat: null, id: "m1", slug: "sentinel", name: "Sentinel", os: "linux", difficulty: "easy", points: 20, rating: 4.6, ratingCount: 1820, userOwns: 9240, rootOwns: 7110, isActive: true, isFree: true, releasedAt: "2026-05-10", retiresAt: null, tags: ["web", "sqli"], makers: [MAKERS[0]!], thumbnailColor: "#7C3AED" },
  { delivery: "spawn", staticHost: null, downloadUrl: null, downloadSha256: null, downloadSizeBytes: null, downloadFormat: null, id: "m2", slug: "irongate", name: "IronGate", os: "windows", difficulty: "medium", points: 30, rating: 4.4, ratingCount: 1330, userOwns: 5120, rootOwns: 3980, isActive: true, isFree: false, releasedAt: "2026-05-03", retiresAt: null, tags: ["ad", "smb"], makers: [MAKERS[1]!], thumbnailColor: "#2563EB" },
  { delivery: "spawn", staticHost: null, downloadUrl: null, downloadSha256: null, downloadSizeBytes: null, downloadFormat: null, id: "m3", slug: "obsidian", name: "Obsidian", os: "linux", difficulty: "hard", points: 40, rating: 4.8, ratingCount: 940, userOwns: 2010, rootOwns: 1240, isActive: true, isFree: false, releasedAt: "2026-04-26", retiresAt: null, tags: ["pwn", "kernel"], makers: [MAKERS[2]!], thumbnailColor: "#6D28D9" },
  { delivery: "spawn", staticHost: null, downloadUrl: null, downloadSha256: null, downloadSizeBytes: null, downloadFormat: null, id: "m4", slug: "cipher", name: "Cipher", os: "linux", difficulty: "medium", points: 30, rating: 4.2, ratingCount: 1110, userOwns: 4300, rootOwns: 3220, isActive: true, isFree: false, releasedAt: "2026-04-19", retiresAt: null, tags: ["crypto", "web"], makers: [MAKERS[0]!], thumbnailColor: "#1D4ED8" },
  { delivery: "spawn", staticHost: null, downloadUrl: null, downloadSha256: null, downloadSizeBytes: null, downloadFormat: null, id: "m5", slug: "warden", name: "Warden", os: "windows", difficulty: "insane", points: 50, rating: 4.9, ratingCount: 610, userOwns: 720, rootOwns: 380, isActive: true, isFree: false, releasedAt: "2026-04-12", retiresAt: null, tags: ["ad", "pwn"], makers: [MAKERS[1]!], thumbnailColor: "#3B82F6" },
  { delivery: "spawn", staticHost: null, downloadUrl: null, downloadSha256: null, downloadSizeBytes: null, downloadFormat: null, id: "m6", slug: "harbor", name: "Harbor", os: "linux", difficulty: "easy", points: 20, rating: 4.1, ratingCount: 2210, userOwns: 11200, rootOwns: 9010, isActive: true, isFree: true, releasedAt: "2026-04-05", retiresAt: null, tags: ["docker", "web"], makers: [MAKERS[2]!], thumbnailColor: "#8B5CF6" },
  { delivery: "spawn", staticHost: null, downloadUrl: null, downloadSha256: null, downloadSizeBytes: null, downloadFormat: null, id: "m7", slug: "relay", name: "Relay", os: "linux", difficulty: "medium", points: 30, rating: 4.5, ratingCount: 980, userOwns: 3600, rootOwns: 2700, isActive: false, isFree: true, releasedAt: "2026-02-01", retiresAt: "2026-04-01", tags: ["network"], makers: [MAKERS[0]!], thumbnailColor: "#7C3AED" },
  { delivery: "spawn", staticHost: null, downloadUrl: null, downloadSha256: null, downloadSizeBytes: null, downloadFormat: null, id: "m8", slug: "phantom", name: "Phantom", os: "windows", difficulty: "hard", points: 40, rating: 4.7, ratingCount: 720, userOwns: 1500, rootOwns: 980, isActive: false, isFree: true, releasedAt: "2026-01-15", retiresAt: "2026-03-15", tags: ["ad", "evasion"], makers: [MAKERS[1]!], thumbnailColor: "#2563EB" },
];

export function mockMachinesPage(): Paginated<Machine> {
  return { items: MOCK_MACHINES, meta: { total: MOCK_MACHINES.length, limit: 24, offset: 0, hasMore: false } };
}

export function mockMachineDetail(slug: string): MachineDetail {
  const base = MOCK_MACHINES.find((m) => m.slug === slug) ?? MOCK_MACHINES[0]!;
  return {
    ...base,
    description:
      "A vulnerable host running an outdated web stack. Enumerate the exposed services, find a foothold through the web application, then escalate to root by abusing a misconfigured service. Two flags: user and root.",
    progress: { userFlagged: false, rootFlagged: false, userFlaggedAt: null, rootFlaggedAt: null },
  };
}

export const MOCK_INSTANCES: Instance[] = [];

export const MOCK_DASHBOARD: DashboardSummary = {
  user: {
    username: "you",
    tier: "pro_hacker",
    rank: 842,
    points: 18450,
    nextTier: { tier: "elite_hacker", pointsNeeded: 1550 },
  },
  stats: { machinesOwned: 47, challengesSolved: 112, currentStreakDays: 9, globalRank: 842 },
  activeTrack: { slug: "beginner", name: "Beginner track", completed: 13, total: 19 },
  recentActivity: [
    { id: "a1", type: "root_own", title: "Rooted Sentinel", subtitle: "Linux · Easy", points: 20, at: new Date(Date.now() - 3600_000).toISOString() },
    { id: "a2", type: "challenge_solve", title: "Solved 'Baby RSA'", subtitle: "Crypto challenge", points: 15, at: new Date(Date.now() - 9000_000).toISOString() },
    { id: "a3", type: "rank_up", title: "Climbed to rank #842", subtitle: "+1,204 this week", points: null, at: new Date(Date.now() - 86400_000).toISOString() },
    { id: "a4", type: "user_own", title: "User flag on IronGate", subtitle: "Windows · Medium", points: 10, at: new Date(Date.now() - 172800_000).toISOString() },
    { id: "a5", type: "ctf", title: "Placed 14th in Weekly CTF", subtitle: "Jeopardy · 12 solves", points: 340, at: new Date(Date.now() - 259200_000).toISOString() },
  ],
};

const LB_SEED: Omit<LeaderRow, "rank">[] = [
  { userId: "u1", username: "zer0Kelvin", avatarUrl: null, country: "de", tier: "elite_operator", points: 142850, ownedMachines: 538, solvedChallenges: 1240, firstBloods: 0, streakDays: 0, acceptedBugs: 0, change: 0 },
  { userId: "u2", username: "sh4dowByte", avatarUrl: null, country: "pk", tier: "elite_operator", points: 138200, ownedMachines: 512, solvedChallenges: 1190, firstBloods: 0, streakDays: 0, acceptedBugs: 0, change: 1 },
  { userId: "u3", username: "nullptr_", avatarUrl: null, country: "us", tier: "guru", points: 131940, ownedMachines: 498, solvedChallenges: 1110, firstBloods: 0, streakDays: 0, acceptedBugs: 0, change: -1 },
  { userId: "u4", username: "kr4ken", avatarUrl: null, country: "jp", tier: "guru", points: 128500, ownedMachines: 470, solvedChallenges: 1080, firstBloods: 0, streakDays: 0, acceptedBugs: 0, change: 2 },
  { userId: "u5", username: "h3xqueen", avatarUrl: null, country: "br", tier: "pro_hacker", points: 121300, ownedMachines: 445, solvedChallenges: 1020, firstBloods: 0, streakDays: 0, acceptedBugs: 0, change: 0 },
  { userId: "u6", username: "ghostshell", avatarUrl: null, country: "in", tier: "pro_hacker", points: 117600, ownedMachines: 432, solvedChallenges: 990, firstBloods: 0, streakDays: 0, acceptedBugs: 0, change: 3 },
  { userId: "u7", username: "bin4ryFox", avatarUrl: null, country: "gb", tier: "elite_hacker", points: 109450, ownedMachines: 410, solvedChallenges: 940, firstBloods: 0, streakDays: 0, acceptedBugs: 0, change: -2 },
  { userId: "u8", username: "seg.fault", avatarUrl: null, country: "fr", tier: "elite_hacker", points: 104200, ownedMachines: 398, solvedChallenges: 910, firstBloods: 0, streakDays: 0, acceptedBugs: 0, change: 1 },
  { userId: "u9", username: "stackSmasher", avatarUrl: null, country: "nl", tier: "elite_hacker", points: 98700, ownedMachines: 380, solvedChallenges: 870, firstBloods: 0, streakDays: 0, acceptedBugs: 0, change: 0 },
  { userId: "u10", username: "rootveil", avatarUrl: null, country: "ca", tier: "pro_hacker", points: 94100, ownedMachines: 366, solvedChallenges: 840, firstBloods: 0, streakDays: 0, acceptedBugs: 0, change: 4 },
  { userId: "u11", username: "0xAurora", avatarUrl: null, country: "au", tier: "pro_hacker", points: 90500, ownedMachines: 352, solvedChallenges: 810, firstBloods: 0, streakDays: 0, acceptedBugs: 0, change: -1 },
  { userId: "u12", username: "vellichor", avatarUrl: null, country: "se", tier: "pro_hacker", points: 87200, ownedMachines: 340, solvedChallenges: 780, firstBloods: 0, streakDays: 0, acceptedBugs: 0, change: 2 },
];

export function mockLeaderboard(): Paginated<LeaderRow> {
  const items = LB_SEED.map((r, i) => ({ ...r, rank: i + 1 }));
  return { items, meta: { total: items.length, limit: 50, offset: 0, hasMore: false } };
}

export const MOCK_SEASONS: Season[] = [
  { id: "s7", name: "Season 7", number: 7, startsAt: "2026-04-01", endsAt: "2026-06-30", isActive: true },
  { id: "s6", name: "Season 6", number: 6, startsAt: "2026-01-01", endsAt: "2026-03-31", isActive: false },
  { id: "s5", name: "Season 5", number: 5, startsAt: "2025-10-01", endsAt: "2025-12-31", isActive: false },
];

export const MOCK_TRACKS: Track[] = [
  { id: "t1", slug: "beginner", name: "Beginner Path", description: "From zero to your first root flag. Covers recon, web fundamentals, privilege escalation basics, and CTF methodology.", difficulty: "beginner", moduleCount: 19, estimatedHours: 24, tags: ["recon", "web", "linux"], isFree: true, isNew: false, thumbnailColor: "#34D399", progress: { completed: 13, total: 19 } },
  { id: "t2", slug: "web-hacking", name: "Web Hacking", description: "Deep dive into OWASP Top 10, modern API exploitation, auth bypasses, SSRF, XXE, and beyond.", difficulty: "intermediate", moduleCount: 24, estimatedHours: 36, tags: ["web", "burp", "api"], isFree: false, isNew: false, thumbnailColor: "#2563EB", progress: null },
  { id: "t3", slug: "active-directory", name: "Active Directory Attacks", description: "Kerberoasting, AS-REP roasting, ACL abuse, DCSync, BloodHound, and full domain takeover chains.", difficulty: "advanced", moduleCount: 18, estimatedHours: 30, tags: ["windows", "ad", "kerberos"], isFree: false, isNew: false, thumbnailColor: "#7C3AED", progress: null },
  { id: "t4", slug: "binary-exploitation", name: "Binary Exploitation", description: "Stack/heap overflows, ret2libc, ROP chains, format strings, GOT overwrite, and kernel intro.", difficulty: "expert", moduleCount: 22, estimatedHours: 48, tags: ["pwn", "reversing", "rop"], isFree: false, isNew: true, thumbnailColor: "#F87171", progress: null },
  { id: "t5", slug: "network-pentesting", name: "Network Pentesting", description: "Port scanning, service enumeration, MITM, lateral movement, pivoting, and tunnelling techniques.", difficulty: "intermediate", moduleCount: 16, estimatedHours: 20, tags: ["network", "pivoting", "wireshark"], isFree: false, isNew: false, thumbnailColor: "#60A5FA", progress: null },
  { id: "t6", slug: "ctf-methodology", name: "CTF Methodology", description: "Speed-run strategies for jeopardy CTFs — crypto, forensics, stego, reverse, pwn, and web categories.", difficulty: "intermediate", moduleCount: 14, estimatedHours: 18, tags: ["ctf", "crypto", "forensics"], isFree: true, isNew: true, thumbnailColor: "#FBBF24", progress: null },
];

export function mockTrackDetail(slug: string): TrackDetail {
  const base = MOCK_TRACKS.find((t) => t.slug === slug) ?? MOCK_TRACKS[0]!;
  return {
    ...base,
    longDescription: `${base.description} Each module combines guided theory with hands-on exercises on real vulnerable systems. You work at your own pace and unlock the next module only after completing the current one.`,
    skills: base.tags.concat(["report writing", "methodology", "enumeration"]),
    modules: Array.from({ length: base.moduleCount }, (_, i) => ({
      id: `${base.id}-m${i + 1}`,
      order: i + 1,
      title: `Module ${i + 1}: ${["Introduction", "Enumeration", "Exploitation", "Post-Exploitation", "Persistence", "Reporting"][i % 6]}`,
      description: "Guided hands-on exercise with a real target environment.",
      type: (["theory", "lab", "challenge", "boss"] as const)[i % 4]!,
      estimatedMinutes: 30 + (i % 3) * 15,
      isLocked: base.progress ? i >= base.progress.completed : i > 0,
      completed: base.progress ? i < base.progress.completed : false,
    })),
  };
}

export function mockTracksPage(): Paginated<Track> {
  return { items: MOCK_TRACKS, meta: { total: MOCK_TRACKS.length, limit: 24, offset: 0, hasMore: false } };
}

export function mockHallOfFame(): HallOfFameEntry[] {
  const lb = mockLeaderboard().items;
  return [
    { season: MOCK_SEASONS[1]!, champion: lb[2]! },
    { season: MOCK_SEASONS[2]!, champion: lb[0]! },
    { season: { id: "s4", name: "Season 4", number: 4, startsAt: "2025-07-01", endsAt: "2025-09-30", isActive: false }, champion: lb[1]! },
  ];
}
