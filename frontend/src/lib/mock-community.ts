/**
 * Mock seed data for CTF, forum, and writeups — used as fallback during the
 * build-then-wire workflow (same pattern as mock-data.ts).
 */

import type { Paginated } from "@/types";
import type { CtfEvent, CtfChallenge, ScoreboardRow } from "@/types/ctf";
import type { ForumCategory, ForumThread, ForumPost, Writeup, WriteupDetail } from "@/types/forum";

/* ---------------------------------- CTF ----------------------------------- */
export const MOCK_CTF_EVENTS: CtfEvent[] = [
  { id: "c1", slug: "winter-clash-2026", name: "Winter Clash 2026", description: "Our flagship seasonal jeopardy CTF. 48 hours, 40 challenges, glory on the line.", format: "jeopardy", state: "live", startsAt: new Date(Date.now() - 3600_000 * 6).toISOString(), endsAt: new Date(Date.now() + 3600_000 * 42).toISOString(), participantCount: 8420, teamCount: 2110, challengeCount: 40, prizePool: "$15,000", bannerColor: "#7C3AED", bannerImageUrl: null, status: "live", teamPlay: false, soloPlay: true, maxTeamSize: null, isRegistered: true },
  { id: "c2", slug: "weekly-sprint-w22", name: "Weekly Sprint #22", description: "A quick 6-hour jeopardy sprint. Perfect for a Saturday afternoon.", format: "jeopardy", state: "upcoming", startsAt: new Date(Date.now() + 3600_000 * 30).toISOString(), endsAt: new Date(Date.now() + 3600_000 * 36).toISOString(), participantCount: 1240, teamCount: 980, challengeCount: 18, prizePool: null, bannerColor: "#2563EB", bannerImageUrl: null, status: "live", teamPlay: false, soloPlay: true, maxTeamSize: null, isRegistered: false },
  { id: "c3", slug: "redteam-royale", name: "RedTeam Royale", description: "Attack-defense warfare. Patch your services while breaking everyone else's.", format: "attack_defense", state: "upcoming", startsAt: new Date(Date.now() + 3600_000 * 24 * 5).toISOString(), endsAt: new Date(Date.now() + 3600_000 * 24 * 5 + 3600_000 * 8).toISOString(), participantCount: 640, teamCount: 80, challengeCount: 12, prizePool: "$8,000", bannerColor: "#6D28D9", bannerImageUrl: null, status: "live", teamPlay: false, soloPlay: true, maxTeamSize: null, isRegistered: false },
  { id: "c4", slug: "autumn-open-2025", name: "Autumn Open 2025", description: "Last season's open jeopardy event. Now available for practice.", format: "jeopardy", state: "ended", startsAt: "2025-10-12T12:00:00Z", endsAt: "2025-10-14T12:00:00Z", participantCount: 11200, teamCount: 3400, challengeCount: 45, prizePool: "$20,000", bannerColor: "#1D4ED8", bannerImageUrl: null, status: "live", teamPlay: false, soloPlay: true, maxTeamSize: null, isRegistered: false },
];

export function mockCtfEvents(): Paginated<CtfEvent> {
  return { items: MOCK_CTF_EVENTS, meta: { total: MOCK_CTF_EVENTS.length, limit: 24, offset: 0, hasMore: false } };
}

export function mockCtfEvent(slug: string): CtfEvent {
  return MOCK_CTF_EVENTS.find((e) => e.slug === slug) ?? MOCK_CTF_EVENTS[0]!;
}

export const MOCK_CHALLENGES: CtfChallenge[] = [
  { id: "ch1", title: "Cookie Monster", category: "web", points: 100, difficulty: "low", description: "The login form trusts a little too much. Inspect what the server hands back, and help yourself to admin.", solveCount: 1840, solved: true, files: [], hints: [{ id: "h1", cost: 10, unlocked: false, text: null }], connectionInfo: "http://10.10.20.5:8080", firstBlood: { username: "zer0Kelvin", at: new Date(Date.now() - 3600_000 * 5).toISOString() } },
  { id: "ch2", title: "Baby RSA", category: "crypto", points: 150, difficulty: "low", description: "Small exponent, no padding. You know what to do.", solveCount: 1320, solved: false, files: [{ name: "challenge.txt", sizeBytes: 1024, url: "#" }], hints: [{ id: "h2", cost: 15, unlocked: false, text: null }], connectionInfo: null, firstBlood: { username: "nullptr_", at: new Date(Date.now() - 3600_000 * 4).toISOString() } },
  { id: "ch3", title: "Stack Overflow", category: "pwn", points: 250, difficulty: "medium", description: "Classic buffer overflow with a twist — NX is on. Find the gadgets.", solveCount: 640, solved: false, files: [{ name: "vuln", sizeBytes: 18000, url: "#" }, { name: "libc.so.6", sizeBytes: 2000000, url: "#" }], hints: [{ id: "h3", cost: 25, unlocked: false, text: null }, { id: "h3b", cost: 40, unlocked: false, text: null }], connectionInfo: "nc 10.10.20.5 31337", firstBlood: null },
  { id: "ch4", title: "Hidden in Plain Sight", category: "forensics", points: 200, difficulty: "medium", description: "This PNG is hiding more than pixels. Carve it open.", solveCount: 810, solved: false, files: [{ name: "evidence.png", sizeBytes: 4500000, url: "#" }], hints: [], connectionInfo: null, firstBlood: { username: "h3xqueen", at: new Date(Date.now() - 3600_000 * 3).toISOString() } },
  { id: "ch5", title: "Reverse Me", category: "reverse", points: 300, difficulty: "high", description: "A stripped binary checks your serial. Defeat the check.", solveCount: 290, solved: false, files: [{ name: "crackme", sizeBytes: 32000, url: "#" }], hints: [{ id: "h5", cost: 30, unlocked: false, text: null }], connectionInfo: null, firstBlood: null },
  { id: "ch6", title: "Who Am I", category: "osint", points: 150, difficulty: "low", description: "Track down the person behind this handle using only public sources.", solveCount: 1100, solved: false, files: [], hints: [], connectionInfo: null, firstBlood: { username: "ghostshell", at: new Date(Date.now() - 3600_000 * 2).toISOString() } },
];

const SB_SEED: Omit<ScoreboardRow, "rank">[] = [
  { teamId: "t1", teamName: "0x00sec", country: "de", points: 3850, solveCount: 28, lastSolveAt: new Date(Date.now() - 600_000).toISOString(), change: 0 },
  { teamId: "t2", teamName: "ByteReapers", country: "pk", points: 3720, solveCount: 27, lastSolveAt: new Date(Date.now() - 900_000).toISOString(), change: 1 },
  { teamId: "t3", teamName: "Null Terminators", country: "us", points: 3540, solveCount: 26, lastSolveAt: new Date(Date.now() - 1200_000).toISOString(), change: -1 },
  { teamId: "t4", teamName: "SegFault Syndicate", country: "jp", points: 3210, solveCount: 24, lastSolveAt: new Date(Date.now() - 1800_000).toISOString(), change: 2 },
  { teamId: "t5", teamName: "Heap Spray Heroes", country: "br", points: 2980, solveCount: 22, lastSolveAt: new Date(Date.now() - 2400_000).toISOString(), change: 0 },
  { teamId: "t6", teamName: "Phantom Shells", country: "in", points: 2750, solveCount: 21, lastSolveAt: new Date(Date.now() - 3000_000).toISOString(), change: 3 },
  { teamId: "t7", teamName: "Kernel Panic", country: "gb", points: 2510, solveCount: 19, lastSolveAt: new Date(Date.now() - 3600_000).toISOString(), change: -2 },
  { teamId: "t8", teamName: "RootCause", country: "fr", points: 2300, solveCount: 18, lastSolveAt: new Date(Date.now() - 4200_000).toISOString(), change: 1 },
];

export function mockScoreboard(): Paginated<ScoreboardRow> {
  const items = SB_SEED.map((r, i) => ({ ...r, rank: i + 1 }));
  return { items, meta: { total: items.length, limit: 100, offset: 0, hasMore: false } };
}

/* --------------------------------- forum ---------------------------------- */
export const MOCK_CATEGORIES: ForumCategory[] = [
  { slug: "machines", name: "Machines", description: "Discuss boxes, share nudges (no spoilers!), and get unstuck.", icon: "Server", threadCount: 4820, postCount: 38400, color: "#7C3AED" },
  { slug: "challenges", name: "Challenges", description: "Crypto, pwn, web, reverse — talk through the puzzles.", icon: "Flag", threadCount: 2310, postCount: 18900, color: "#2563EB" },
  { slug: "ctf", name: "CTF", description: "Event announcements, team recruitment, and post-mortems.", icon: "Trophy", threadCount: 980, postCount: 7600, color: "#6D28D9" },
  { slug: "career", name: "Career & Certs", description: "OSCP, jobs, interviews, and the road to going pro.", icon: "Briefcase", threadCount: 1540, postCount: 12300, color: "#1D4ED8" },
  { slug: "general", name: "General", description: "Everything else — introductions, news, and off-topic.", icon: "MessagesSquare", threadCount: 3200, postCount: 24100, color: "#8B5CF6" },
  { slug: "help", name: "Help & Support", description: "Platform issues, VPN trouble, and account questions.", icon: "LifeBuoy", threadCount: 760, postCount: 4200, color: "#3B82F6" },
];

const AUTHORS = [
  { username: "zer0Kelvin", avatarUrl: null, tier: "elite_operator" as const },
  { username: "sh4dowByte", avatarUrl: null, tier: "elite_operator" as const },
  { username: "ghostshell", avatarUrl: null, tier: "pro_hacker" as const },
  { username: "bin4ryFox", avatarUrl: null, tier: "elite_hacker" as const },
];

export const MOCK_THREADS: ForumThread[] = [
  { id: "th1", title: "Sentinel — stuck on privesc after getting www-data", categorySlug: "machines", categoryName: "Machines", author: AUTHORS[2]!, excerpt: "I've got a shell as www-data and found the cron job, but the script isn't writable. Am I missing something obvious here?", replyCount: 14, viewCount: 820, voteScore: 23, isPinned: false, isLocked: false, isSolved: true, tags: ["sentinel", "linux", "privesc"], createdAt: new Date(Date.now() - 3600_000 * 8).toISOString(), lastReplyAt: new Date(Date.now() - 3600_000 * 2).toISOString(), lastReplyBy: "zer0Kelvin" },
  { id: "th2", title: "📌 Forum rules & how to ask for help without spoilers", categorySlug: "machines", categoryName: "Machines", author: AUTHORS[0]!, excerpt: "Welcome! Before posting, please read these guidelines on giving and receiving nudges without ruining the box for others.", replyCount: 3, viewCount: 12400, voteScore: 312, isPinned: true, isLocked: true, isSolved: false, tags: ["rules", "meta"], createdAt: new Date(Date.now() - 86400_000 * 30).toISOString(), lastReplyAt: new Date(Date.now() - 86400_000 * 4).toISOString(), lastReplyBy: "sh4dowByte" },
  { id: "th3", title: "Baby RSA — is the exponent really 3?", categorySlug: "challenges", categoryName: "Challenges", author: AUTHORS[3]!, excerpt: "Trying the cube-root attack but it's not landing. Want to make sure I'm reading the params right before I go deeper.", replyCount: 9, viewCount: 540, voteScore: 11, isPinned: false, isLocked: false, isSolved: false, tags: ["crypto", "rsa"], createdAt: new Date(Date.now() - 3600_000 * 12).toISOString(), lastReplyAt: new Date(Date.now() - 3600_000 * 5).toISOString(), lastReplyBy: "ghostshell" },
  { id: "th4", title: "Passed OSCP on my second try — AMA + what OFFCON boxes helped most", categorySlug: "career", categoryName: "Career & Certs", author: AUTHORS[1]!, excerpt: "After failing the first attempt I ground out ~60 boxes here. Sharing my exact prep, the tracks that mattered, and exam-day tips.", replyCount: 87, viewCount: 9800, voteScore: 421, isPinned: false, isLocked: false, isSolved: false, tags: ["oscp", "prep"], createdAt: new Date(Date.now() - 86400_000 * 2).toISOString(), lastReplyAt: new Date(Date.now() - 3600_000 * 1).toISOString(), lastReplyBy: "bin4ryFox" },
  { id: "th5", title: "Winter Clash 2026 — looking for 1 more for our team (web/crypto)", categorySlug: "ctf", categoryName: "CTF", author: AUTHORS[2]!, excerpt: "We're 3 and need a 4th comfortable with web and light crypto. Currently top 50. DM me if interested!", replyCount: 6, viewCount: 310, voteScore: 8, isPinned: false, isLocked: false, isSolved: false, tags: ["winter-clash", "team"], createdAt: new Date(Date.now() - 3600_000 * 4).toISOString(), lastReplyAt: new Date(Date.now() - 3600_000 * 1).toISOString(), lastReplyBy: "zer0Kelvin" },
];

export function mockThreads(): Paginated<ForumThread> {
  return { items: MOCK_THREADS, meta: { total: MOCK_THREADS.length, limit: 25, offset: 0, hasMore: false } };
}

export function mockThread(id: string): ForumThread {
  return MOCK_THREADS.find((t) => t.id === id) ?? MOCK_THREADS[0]!;
}

export function mockPosts(threadId: string): ForumPost[] {
  const t = mockThread(threadId);
  return [
    { id: "p1", threadId, author: t.author, bodyMd: t.excerpt + "\n\nHere's what I've tried so far:\n\n- Enumerated all SUID binaries\n- Checked cron with `pspy`\n- Looked at writable paths in `$PATH`\n\nAny pointers appreciated (no spoilers please).", voteScore: t.voteScore, userVote: 0, isAcceptedAnswer: false, isOriginalPost: true, createdAt: t.createdAt, editedAt: null },
    { id: "p2", threadId, author: AUTHORS[0]!, bodyMd: "You're closer than you think. Re-read the cron line **carefully** — what does it actually execute, and from where? Think about your `$PATH`. 😉", voteScore: 18, userVote: 0, isAcceptedAnswer: true, isOriginalPost: false, createdAt: new Date(Date.now() - 3600_000 * 3).toISOString(), editedAt: null },
    { id: "p3", threadId, author: AUTHORS[3]!, bodyMd: "What @zer0Kelvin said. I was stuck on the exact same thing — the answer is *not* editing the script itself.", voteScore: 7, userVote: 0, isAcceptedAnswer: false, isOriginalPost: false, createdAt: new Date(Date.now() - 3600_000 * 2).toISOString(), editedAt: null },
  ];
}

/* -------------------------------- writeups -------------------------------- */
export const MOCK_WRITEUPS: Writeup[] = [
  { id: "w1", slug: "sentinel-writeup", title: "Sentinel — From SQLi to Root via Cron PATH Hijack", author: AUTHORS[0]!, target: { kind: "machine", name: "Sentinel", slug: "sentinel" }, os: "linux", difficulty: "easy", excerpt: "A full walkthrough of Sentinel: exploiting a blind SQL injection for initial access, then escalating to root by hijacking a relative binary in a cron job's PATH.", readMinutes: 8, voteScore: 142, commentCount: 23, tags: ["sentinel", "sqli", "privesc"], publishedAt: new Date(Date.now() - 86400_000 * 3).toISOString(), locked: false },
  { id: "w2", slug: "irongate-writeup", title: "IronGate — Kerberoasting Your Way to Domain Admin", author: AUTHORS[1]!, target: { kind: "machine", name: "IronGate", slug: "irongate" }, os: "windows", difficulty: "medium", excerpt: "IronGate is a great intro to Active Directory attacks. We enumerate with BloodHound, kerberoast a service account, and pivot to DA.", readMinutes: 14, voteScore: 98, commentCount: 17, tags: ["ad", "kerberoast", "bloodhound"], publishedAt: new Date(Date.now() - 86400_000 * 6).toISOString(), locked: true },
  { id: "w3", slug: "baby-rsa-writeup", title: "Baby RSA — Cube Root Attack Explained", author: AUTHORS[3]!, target: { kind: "challenge", name: "Baby RSA", slug: "baby-rsa" }, os: null, difficulty: null, excerpt: "Why a small public exponent with no padding is fatal, and how to recover the plaintext with a simple integer cube root.", readMinutes: 5, voteScore: 76, commentCount: 9, tags: ["crypto", "rsa"], publishedAt: new Date(Date.now() - 86400_000 * 9).toISOString(), locked: false },
  { id: "w4", slug: "obsidian-writeup", title: "Obsidian — Kernel Exploitation Deep Dive", author: AUTHORS[0]!, target: { kind: "machine", name: "Obsidian", slug: "obsidian" }, os: "linux", difficulty: "hard", excerpt: "The hardest box this season. A vulnerable kernel module, a heap groom, and a ROP chain into ring 0. Buckle up.", readMinutes: 26, voteScore: 211, commentCount: 41, tags: ["kernel", "pwn", "rop"], publishedAt: new Date(Date.now() - 86400_000 * 12).toISOString(), locked: true },
];

export function mockWriteups(): Paginated<Writeup> {
  return { items: MOCK_WRITEUPS, meta: { total: MOCK_WRITEUPS.length, limit: 24, offset: 0, hasMore: false } };
}

export function mockWriteupDetail(slug: string): WriteupDetail {
  const base = MOCK_WRITEUPS.find((w) => w.slug === slug) ?? MOCK_WRITEUPS[0]!;
  return {
    ...base,
    userVote: 0,
    locked: false, // detail fetch implies access granted
    bodyMd: `## Reconnaissance

We start with a full TCP port scan to see what we're working with:

\`\`\`bash
nmap -sC -sV -p- 10.10.14.7
\`\`\`

Two ports stand out: **22** (SSH) and **80** (HTTP). Let's focus on the web app first.

## Initial foothold

The login form at \`/login\` is vulnerable to a blind boolean SQL injection. By measuring response differences we can extract the admin password hash character by character.

> Tip: automate the extraction with a short Python script rather than doing it by hand.

Once we crack the hash offline, we log in as **admin** and find a file-upload feature that lets us drop a PHP web shell.

## Privilege escalation

Running \`pspy\` reveals a cron job executing as root every minute:

\`\`\`
* * * * * root cd /opt/app && backup.sh
\`\`\`

The key insight: \`backup.sh\` is called **without an absolute path**. By placing our own \`backup.sh\` earlier in the cron's \`PATH\`, we get code execution as root.

\`\`\`bash
echo 'cp /bin/bash /tmp/rootbash; chmod +s /tmp/rootbash' > /tmp/backup.sh
chmod +x /tmp/backup.sh
\`\`\`

A minute later, \`/tmp/rootbash -p\` drops us into a root shell. 🩸

## Flags

- **User:** \`OFFCON{sql1_t0_w3bsh3ll}\`
- **Root:** \`OFFCON{cr0n_p4th_hij4ck}\`

## Takeaways

- Always check whether scripts in cron jobs use absolute paths.
- \`PATH\` hijacking is one of the most common Linux privesc vectors — and one of the easiest to prevent.`,
  };
}
