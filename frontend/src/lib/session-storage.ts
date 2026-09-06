"use client";

/**
 * Where the session lives so every surface shares it.
 *
 * localStorage is scoped to an origin, and the four surfaces are four origins.
 * With the session there, signing in on `localhost` left `ctf.localhost` logged
 * out — one account, four sign-ins.
 *
 * A cookie scoped to the parent domain is shared by every subdomain, which is
 * the whole point — but only for a real registrable domain.
 *
 * `localhost` is not one. Chrome accepts `Domain=localhost` when the cookie is
 * written *on* `localhost`, refuses to send it to `dashboard.localhost`, and
 * silently rejects the write outright when it comes *from* a subdomain. That
 * last part is what turned a missing session into an infinite login loop: the
 * session could never be stored, so the guard bounced to /login forever. Tested
 * in Chrome, not assumed.
 *
 * Development therefore uses `lvh.me`, which is a real domain whose every
 * subdomain resolves to 127.0.0.1 — no hosts file, and cookies behave exactly
 * as they will on `offensiveconditions.org`.
 *
 * SECURITY: this cookie is readable by JavaScript, so an XSS on any surface can
 * take the session — exactly as true of the localStorage it replaces, so this
 * is not a regression, but it is not the destination either. The right design
 * is auth-svc setting an httpOnly, SameSite=Lax cookie on the parent domain and
 * reading it server-side on /v1/auth/refresh, which puts the refresh token out
 * of reach of page scripts entirely. Do that before public launch.
 */

import type { StateStorage } from "zustand/middleware";

/** Root the cookie is scoped to. Empty means "this host only". */
const ROOT = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "";

/**
 * The Domain attribute for the session cookie.
 *
 * The port is stripped: cookies have no concept of one, and leaving
 * "localhost:3000" in there produces an attribute the browser silently
 * discards — which looks exactly like the cookie not being set at all.
 */
function cookieDomain(): string | null {
  if (!ROOT) return null;
  const host = ROOT.split(":")[0];
  return host || null;
}

/** Session cookies outlive a tab; a week matches the refresh token's life. */
const MAX_AGE = 7 * 24 * 60 * 60;

function read(name: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${name}=`;
  for (const part of document.cookie.split("; ")) {
    if (part.startsWith(prefix)) {
      try {
        return decodeURIComponent(part.slice(prefix.length));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Delete a host-only cookie of this name, if the browser is holding one.
 *
 * A host-only cookie and a `Domain=`-scoped cookie of the same name are two
 * separate cookies and the browser sends both. `document.cookie` lists the more
 * specific one first, so `read` above returns the host-only value and the
 * shared session is written, ignored, and written again — every surface asks
 * for its own sign-in even though the shared cookie is sitting right there.
 *
 * They appear whenever NEXT_PUBLIC_ROOT_DOMAIN did not match the host serving
 * the page: the browser rejects `Domain=` for a domain it is not under, the
 * fallback in `write` stores a host-only cookie instead, and that cookie
 * outlives the misconfiguration that created it. Moving from lvh.me to the real
 * domain is exactly that situation, so every account signed in during the
 * switch is carrying one.
 *
 * Clearing it on write means nobody has to know to clear their cookies, and a
 * future domain change heals itself the same way.
 *
 * Omitting `Domain` is what makes this target the host-only cookie and leave
 * the shared one alone — a deletion matches on name, domain and path.
 */
function dropHostOnly(name: string): void {
  document.cookie = `${name}=; Path=/; Max-Age=0`;
}

function write(name: string, value: string): void {
  if (typeof document === "undefined") return;
  const domain = cookieDomain();

  // Before the write, not after: the shared cookie is worthless while a
  // host-only one of the same name is still shadowing it on this host.
  if (domain) dropHostOnly(name);

  const attrs = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${MAX_AGE}`,
    // Lax rather than Strict: a sign-in that ends on a different surface is a
    // top-level navigation between origins, and Strict would withhold the
    // cookie on arrival — the user would land signed out.
    "SameSite=Lax",
    domain ? `Domain=${domain}` : "",
    // Secure would stop the cookie being set at all over plain http, which is
    // how local development runs.
    location.protocol === "https:" ? "Secure" : "",
  ].filter(Boolean);
  document.cookie = attrs.join("; ");

  // A browser can refuse the Domain attribute — `localhost` is the case that
  // taught us this — and the refusal is silent. Without a fallback the session
  // is simply never stored, which the auth guard reads as "signed out" and
  // answers with a redirect to /login, from which signing in leads straight
  // back. Falling back to a host-only cookie keeps that surface working; the
  // session just does not follow you to the next one.
  if (domain && !document.cookie.includes(`${name}=`)) {
    document.cookie = [
      `${name}=${encodeURIComponent(value)}`,
      "Path=/",
      `Max-Age=${MAX_AGE}`,
      "SameSite=Lax",
      location.protocol === "https:" ? "Secure" : "",
    ]
      .filter(Boolean)
      .join("; ");
  }
}

function remove(name: string): void {
  if (typeof document === "undefined") return;
  const domain = cookieDomain();

  // Both variants, or signing out on a subdomain leaves the host-only cookie
  // behind and the next visit reads a session the user thought they ended.
  dropHostOnly(name);

  document.cookie = [
    `${name}=`,
    "Path=/",
    "Max-Age=0",
    domain ? `Domain=${domain}` : "",
  ]
    .filter(Boolean)
    .join("; ");
}

/**
 * Cookie-backed storage for zustand's persist middleware.
 *
 * Only what the store chooses to persist passes through here — see
 * `partialize` in auth-store — which keeps this well under the 4KB a cookie
 * allows.
 */
export const sharedSessionStorage: StateStorage = {
  getItem: (name) => read(name),
  setItem: (name, value) => write(name, value),
  removeItem: (name) => remove(name),
};
