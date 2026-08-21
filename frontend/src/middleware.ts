/**
 * Host-based routing for the four surfaces.
 *
 *   offensiveconditions.org           the landing page
 *   ctf.offensiveconditions.org       events, teams, arena, scoreboards
 *   bugbounty.offensiveconditions.org programs, reports, hacktivity
 *   app.offensiveconditions.org       tracks, machines, forum, everything else
 *
 * One Next app, not four. Four apps would mean four builds, four deploys and
 * four copies of the design system drifting apart — and the auth session has to
 * be shared across all of them anyway, so they cannot be independent in the way
 * separate apps imply.
 *
 * Instead each host owns a slice of the same route tree, and this rewrites the
 * incoming path into it. A rewrite, not a redirect: the URL the visitor sees
 * stays `bugbounty.offensiveconditions.org/programs`, while Next renders
 * `/bounty/programs`. Nothing in the pages has to know it is on a subdomain.
 *
 * Cross-surface links are written host-absolute (see `lib/surfaces.ts`) because
 * a bare `/machines` on the CTF host would resolve to a CTF path.
 */

import { NextResponse, type NextRequest } from "next/server";

/** Paths that belong to no single surface and must resolve on every host. */
const SHARED_PREFIXES = [
  "/api",
  "/login",
  "/register",
  "/logout",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/two-factor",
  "/oauth",
  "/auth",
  "/onboarding",
  "/settings",
  "/u",
  "/notifications",
  "/admin",
  "/_next",
  "/fonts",
  "/favicon.ico",
  "/icon.png",
];

type Surface = "landing" | "ctf" | "bugbounty" | "app";

/**
 * Which surface a hostname belongs to.
 *
 * Falls back to "app" for anything unrecognised — a preview deploy, an IP, or
 * `localhost:3000` — so development on a single host still reaches everything
 * through its normal paths.
 */
export function surfaceForHost(host: string): Surface {
  const name = (host.split(":")[0] ?? "").toLowerCase();
  if (name.startsWith("ctf.")) return "ctf";
  if (name.startsWith("bugbounty.") || name.startsWith("bb.")) return "bugbounty";
  if (name.startsWith("app.")) return "app";
  // The apex and www are the marketing site.
  if (name === "offensiveconditions.org" || name === "www.offensiveconditions.org") {
    return "landing";
  }
  return "app";
}

export function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const path = url.pathname;

  if (SHARED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const surface = surfaceForHost(req.headers.get("host") ?? "");
  const rewritten = rewriteFor(surface, path);
  if (!rewritten || rewritten === path) return NextResponse.next();

  const next = url.clone();
  next.pathname = rewritten;
  const res = NextResponse.rewrite(next);
  // Lets a layout or page render differently per surface without re-parsing
  // the Host header everywhere.
  res.headers.set("x-offcon-surface", surface);
  return res;
}

function rewriteFor(surface: Surface, path: string): string | null {
  switch (surface) {
    case "ctf":
      // The CTF host is rooted at the events index: ctf.…/ is the event list,
      // ctf.…/summer-2026 is one event. Teams belong here too — a team only
      // means anything in the context of an event.
      if (path === "/") return "/ctf";
      if (path.startsWith("/teams") || path.startsWith("/leaderboard")) return path;
      if (path.startsWith("/ctf")) return path;
      return `/ctf${path}`;

    case "bugbounty":
      // Rooted at opportunity discovery.
      if (path === "/") return "/bounty";
      if (path.startsWith("/bounty")) return path;
      return `/bounty${path}`;

    case "landing":
      // Apex serves the marketing pages only; anything deeper is an app path
      // that belongs on app.<domain>, so leave it alone and let the 404 say so.
      return null;

    case "app":
    default:
      return null;
  }
}

export const config = {
  // Everything except Next's own assets, which SHARED_PREFIXES also covers —
  // this keeps them from entering the middleware at all.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
