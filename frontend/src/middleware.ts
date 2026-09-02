/**
 * Host-based routing for the four surfaces.
 *
 *   offensiveconditions.org           the landing page (lvh.me in development)
 *   dashboard.offensiveconditions.org where a signed-in player lands
 *   ctf.offensiveconditions.org       events, teams, arena, scoreboards
 *   bugbounty.offensiveconditions.org programs, reports, hacktivity
 *   app.offensiveconditions.org       tracks, machines, forum, writeups
 *   admin.offensiveconditions.org     staff only — triage, moderation, pricing
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

type Surface = "landing" | "dashboard" | "ctf" | "bugbounty" | "app" | "admin";

/**
 * Which surface a hostname belongs to.
 *
 * Falls back to "app" for anything unrecognised — a preview deploy, an IP, or
 * `localhost:3000` — so development on a single host still reaches everything
 * through its normal paths.
 */
export function surfaceForHost(host: string): Surface {
  const name = (host.split(":")[0] ?? "").toLowerCase();
  if (name.startsWith("admin.")) return "admin";
  if (name.startsWith("dashboard.")) return "dashboard";
  if (name.startsWith("ctf.")) return "ctf";
  if (name.startsWith("bugbounty.") || name.startsWith("bb.")) return "bugbounty";
  if (name.startsWith("app.")) return "app";
  // Anything with no surface label is the marketing site: the apex, www, and
  // bare `localhost` in development. Falling back to "app" here put /machines
  // at localhost:3000 and left the landing page with nowhere to live.
  return "landing";
}

/**
 * Sections that belong to exactly one surface.
 *
 * Without this a path landing on the wrong host does not 404 — it gets
 * swallowed by whatever dynamic route is there. `/dashboard` on the CTF host
 * became `/ctf/dashboard`, which matches `/ctf/[slug]` and renders an event
 * page for an event called "dashboard". A redirect sends it where it belongs
 * instead, which also keeps every old single-origin link working.
 */
const OWNER: Record<string, Surface> = {
  dashboard: "dashboard",
  ctf: "ctf",
  bounty: "bugbounty",
  machines: "app",
  tracks: "app",
  forum: "app",
  writeups: "app",
  leaderboard: "app",
};

/** Where a surface sends someone who arrives at its root. */
const ROOT_PATH: Record<Surface, string> = {
  landing: "/",
  admin: "/admin",
  dashboard: "/dashboard",
  ctf: "/ctf",
  bugbounty: "/bounty",
  app: "/machines",
};

export function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const path = url.pathname;

  if (SHARED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const host = req.headers.get("host") ?? "";
  const surface = surfaceForHost(host);

  const first = path.split("/").filter(Boolean)[0];
  const owner = first ? OWNER[first] : undefined;
  if (owner && owner !== surface) {
    const target = hostFor(owner, host);
    // Same host means the surfaces are collapsed onto one origin (no root
    // domain configured), and there is nowhere to redirect to — the path
    // already resolves correctly there.
    if (target && target !== host) {
      const to = new URL(req.url);
      to.host = target;
      to.pathname = stripPrefix(owner, path);
      return NextResponse.redirect(to);
    }
    return NextResponse.next();
  }

  const rewritten = rewriteFor(surface, path);

  // The header goes on every response, rewritten or not. The shell reads it to
  // decide which navigation to render, and a surface that happens to need no
  // rewrite still has to be identifiable — otherwise it falls back to whatever
  // the default is, which is how the dashboard ended up wearing the Academy's
  // sidebar.
  // Set on the *request*, not just the response: the shell is a server
  // component and reads it through headers(), which sees what the request
  // carried. A response header would never reach it.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-offcon-surface", surface);
  const init = { request: { headers: requestHeaders } };

  if (!rewritten || rewritten === path) return NextResponse.next(init);

  const next = url.clone();
  next.pathname = rewritten;
  return NextResponse.rewrite(next, init);
}

function rewriteFor(surface: Surface, path: string): string | null {
  switch (surface) {
    case "dashboard":
      // Rooted at the player's own home. Profile and notifications belong here
      // too — they are about *you*, which is what this surface is.
      if (path === "/") return "/dashboard";
      if (path.startsWith("/dashboard")) return path;
      return `/dashboard${path}`;

    case "admin":
      // Rooted at the panel itself, so admin.<domain> lands on it rather than
      // on whatever the fallback surface happens to serve. /admin stays in
      // SHARED_PREFIXES too, so the existing links from inside the product
      // keep working on whichever host the reader is already on.
      if (path === "/") return "/admin";
      if (path.startsWith("/admin")) return path;
      return `/admin${path}`;

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
      // Everything else keeps its own paths; only the bare root needs a home,
      // and the landing page is not it.
      if (path === "/") return ROOT_PATH.app;
      return null;

    default:
      return null;
  }
}

export const config = {
  // Everything except Next's own assets, which SHARED_PREFIXES also covers —
  // this keeps them from entering the middleware at all.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};


/**
 * The hostname a surface lives on, derived from the current one.
 *
 * Taken from the request rather than from configuration so it works on
 * localhost, on a staging domain and in production without three sets of
 * values to keep in step.
 */
function hostFor(surface: Surface, currentHost: string): string | null {
  const [name, port] = currentHost.split(":");
  if (!name) return null;
  // Strip an existing surface label to get back to the root domain.
  const root = name.replace(/^(admin|dashboard|ctf|bugbounty|bb|app|www)\./, "");
  const label = surface === "landing" ? "" : `${surface}.`;
  const target = `${label}${root}`;
  return port ? `${target}:${port}` : target;
}

/** Drop the prefix a surface owns, since it becomes that host's root. */
function stripPrefix(surface: Surface, path: string): string {
  const prefix = ROOT_PATH[surface];
  if (surface === "app" || prefix === "/" || !path.startsWith(prefix)) return path;
  const rest = path.slice(prefix.length);
  return rest === "" ? "/" : rest;
}
