/**
 * Picks the shell from the surface, which the middleware has already decided.
 *
 * A server component on purpose. The surface is a property of the *hostname*,
 * and the client cannot see it: `usePathname()` returns the URL the browser
 * shows, not the path the middleware rewrote to — so on `ctf.<domain>/` it
 * reads "/", matches neither /dashboard nor /ctf, and every surface fell
 * through to the Academy shell. That is why the dashboard and the CTF arena
 * both wore "OFFCON ACADEMY" and the Academy's sidebar.
 *
 * Reading the header the middleware set answers the question directly, and
 * does it before the first paint rather than after a hydration correction.
 */

import type { Metadata } from "next";
import { headers } from "next/headers";

import { AppShell, type Shape } from "./_components/app-shell";

/**
 * Nothing under this group belongs in a search index.
 *
 * `robots.ts` already disallows the hostnames these routes live on, but a few
 * of them (settings, notifications, the profile pages) are in SHARED_PREFIXES
 * and therefore resolve on the apex too, where robots.txt allows crawling. A
 * `noindex` here covers that gap, and covers it at the level of the page rather
 * than the host — which is the directive that still applies if a URL is reached
 * some way robots.txt did not anticipate, such as from an external link.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const surface = (await headers()).get("x-offcon-surface");
  const shape = shapeFor(surface);

  // The attribute is outside the shell, and therefore outside the auth gate, so
  // which surface the server decided on is visible without a session — from
  // devtools, or from a curl during a deploy check. It is also a CSS hook if a
  // surface ever needs to differ below the shell.
  return (
    <div data-surface={shape} className="contents">
      <AppShell shape={shape}>{children}</AppShell>
    </div>
  );
}

/**
 * Surfaces map to shells, not one-to-one.
 *
 * "app" is the Academy, and the landing surface only reaches this group when
 * everything is collapsed onto one origin — in which case the Academy shell is
 * the sensible default, since that is where most of these routes live.
 */
function shapeFor(surface: string | null): Shape {
  switch (surface) {
    case "dashboard":
      return "dashboard";
    case "ctf":
      return "ctf";
    case "admin":
      return "admin";
    default:
      return "academy";
  }
}
