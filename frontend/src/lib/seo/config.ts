/**
 * Everything the search engines are told about OFFCON, in one file.
 *
 * Titles, descriptions, the sitemap and the JSON-LD graph all read from here
 * rather than carrying their own copies. The reason is duplication drift: the
 * site name appeared in five places before this file existed — the root
 * metadata, the OG tags, the Twitter tags, the footer and the manifest — and a
 * rename would have had to find all five. A mismatch between them is not a
 * cosmetic problem either: Google treats conflicting `og:site_name` and
 * `WebSite.name` as a reason to substitute its own guess in the SERP.
 *
 * Geography is deliberately two-tier. The core pages read as international
 * because the product is, and a Pakistan-only framing on `/` would cost the
 * global queries. The country-specific pages under PK_* below carry the local
 * signal instead, where it can win a query the global copy never would.
 */

import { BRAND } from "@/config/brand";

/** Canonical origin. Every absolute URL in the SEO layer is built from this. */
export const SITE_URL = BRAND.siteUrl.replace(/\/$/, "");

/** Absolute URL for a path, with the duplicate-slash cases collapsed. */
export function absolute(path = "/"): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${SITE_URL}/${path.replace(/^\//, "")}`.replace(/\/$/, "") || SITE_URL;
}

export const SITE = {
  name: BRAND.name,
  fullName: BRAND.fullName,
  tagline: BRAND.tagline,
  url: SITE_URL,
  locale: "en_US",
  email: BRAND.contactEmail,
  /** Founding year, used in the Organization node and the copyright line. */
  founded: "2026",
} as const;

/**
 * The social profiles Google will accept as `sameAs` evidence.
 *
 * Only real, populated profiles belong here. A `sameAs` pointing at a 404
 * weakens the entity rather than strengthening it, which is why this filters
 * the brand config rather than spreading it wholesale — the brand file carries
 * placeholders for handles that may not exist yet.
 */
export const SOCIAL_PROFILES: string[] = Object.values(BRAND.social).filter(
  (u): u is string => typeof u === "string" && u.startsWith("http"),
);

/**
 * Keyword clusters, one per landing page.
 *
 * These are not `<meta name="keywords">` fodder — that tag has been ignored
 * since roughly 2009 and is kept in the root metadata only because removing it
 * costs more review than leaving it. They are here so the page copy, the H1,
 * the title and the sitemap priority for a cluster are decided together
 * instead of drifting apart across four files.
 */
export const CLUSTERS = {
  ctf: {
    path: "/ctf-competitions",
    title: "CTF Competitions — Live Capture The Flag Events",
    description:
      "Compete in live Capture The Flag competitions. Jeopardy and attack-defense formats, real-time scoreboards, first-blood alerts and seasonal championships — solo or with your team.",
    h1: "Capture The Flag competitions, run properly.",
  },
  labs: {
    path: "/hacking-labs",
    title: "Hacking Labs — Vulnerable Machines to Practise On",
    description:
      "Practise on vulnerable machines across Linux, Windows and Active Directory. Every box runs isolated in its own sandbox, spins up in seconds, and tears down cleanly.",
    h1: "Vulnerable machines you can actually break.",
  },
  bounty: {
    path: "/bug-bounty",
    title: "Bug Bounty Platform — Hunt Real Targets, Get Paid",
    description:
      "Take your offensive security skills to live targets. Hunt vulnerabilities in real bug bounty programs, submit structured reports, and earn cash bounties paid straight out.",
    h1: "Bug bounty hunting, from first report to first payout.",
  },
  training: {
    path: "/offensive-security-training",
    title: "Offensive Security Training — Hands-On, Start to Senior",
    description:
      "Structured offensive security training built on doing, not watching. Guided tracks take you from your first nmap scan to advanced exploitation, each module gated on a real, breakable system.",
    h1: "Offensive security training that ends with a shell, not a quiz.",
  },
  conference: {
    path: "/conference",
    title: "OFFCON Conference — Offensive Security & Zero-Day Research",
    description:
      "The OFFCON conference is a stage for advanced offensive security research \u2014 red teaming, exploit development and zero-day disclosure \u2014 bringing researchers from major technology companies together with Pakistan's security community.",
    h1: "Where the research that breaks things gets presented.",
  },
  pakistan: {
    path: "/pakistan",
    title: "Cyber Security Training & CTF in Pakistan",
    description:
      "OFFCON is an offensive security platform built for Pakistan: live CTF competitions, hands-on hacking labs and bug bounty practice, with local pricing in PKR and a national leaderboard.",
    h1: "Offensive security, built for Pakistan.",
  },
} as const;

export type ClusterKey = keyof typeof CLUSTERS;

/**
 * Hosts that must never be indexed.
 *
 * The product is served from six hostnames (see `middleware.ts`) and only the
 * apex carries public content. The rest are either behind `AuthGuard` or are
 * staff-only, so a crawler that reaches them finds a login shell — a ~20KB
 * page with the site's generic title and no body. Dozens of those across three
 * subdomains is exactly the thin-content signal that suppresses the pages that
 * *are* worth ranking, so `robots.ts` serves them a blanket disallow.
 */
export const PRIVATE_SURFACES = ["dashboard", "admin", "app", "ctf", "bugbounty", "bb"] as const;

/**
 * Paths on the apex that exist but should stay out of the index.
 *
 * Auth screens carry no content worth a query, and an indexed `/login` is a
 * small but real drain — it competes with the homepage for brand searches and
 * spends crawl budget that the catalogue pages need.
 */
export const DISALLOWED_PATHS = [
  "/api/",
  "/login",
  "/register",
  "/logout",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/two-factor",
  "/oauth/",
  "/auth/",
  "/onboarding",
  "/settings",
  "/notifications",
  "/billing",
  "/admin",
  "/u/",
] as const;
