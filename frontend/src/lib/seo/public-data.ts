/**
 * The public catalogue, read on the server.
 *
 * The browser client in `lib/api.ts` goes through `/api/*`, which only exists
 * as a Next rewrite for the browser's benefit — a server component calling it
 * would be asking the app to proxy to itself. These read the gateway directly
 * over the Docker network instead.
 *
 * Three properties matter here and none of them are the default:
 *
 *   Unauthenticated. Every endpoint below answers without a token (the
 *     catalogue is public), so nothing here touches the auth store — which a
 *     server component could not reach anyway.
 *
 *   Cached. The sitemap and four landing pages all want the same two lists.
 *     `next.revalidate` makes that one upstream call an hour rather than one
 *     per render, which also means a crawler hammering the sitemap cannot
 *     become load on ctf-svc.
 *
 *   Non-fatal. A failure returns an empty list rather than throwing. A
 *     sitemap that 500s because content-svc was restarting gets retried by
 *     Google on its own schedule — which can be days — and in the meantime the
 *     static pages in it are not being submitted either. A short sitemap
 *     recovers on the next crawl; a broken one does not.
 */

/* Server-only by construction rather than by the `server-only` package, which
   is not a dependency here. Nothing below is safe to pull into a client bundle:
   `GATEWAY` resolves to an address that only exists inside the compose network,
   and `next.revalidate` is meaningless in the browser. Importing this from a
   `"use client"` module will fail at build with a confusing message about
   `fetch` options — if that happens, the fix is to move the call into a server
   component and pass the result down, not to soften this module. */

import {
  isIndexableEvent,
  isIndexableMachine,
  isIndexablePath,
  type IndexableEvent,
  type IndexableMachine,
  type IndexablePath,
} from "./indexable";

/**
 * Inside the compose network the gateway is `edge:8080`; the build passes the
 * same value the browser bundle uses. The fallback is the production gateway
 * so a server rendering outside compose still resolves something real.
 */
const GATEWAY = (
  process.env.OFFCON_INTERNAL_API_URL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  "https://api.offensiveconditions.org"
).replace(/\/$/, "");

/** One hour. Long enough to be free, short enough that a new event is listed
 *  the same day it opens. */
const REVALIDATE = 3600;

export interface PublicEvent extends IndexableEvent {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  format: string | null;
  starts_at: string | null;
  ends_at: string | null;
  updated_at: string | null;
  total_registered: number | null;
  prize_pool: number | null;
  currency: string | null;
  entry_fee_cents: number | null;
  team_play: boolean | null;
  solo_play: boolean | null;
  max_team_size: number | null;
}

export interface PublicMachine extends IndexableMachine {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  os: string | null;
  difficulty: string | null;
  released_at: string | null;
  updated_at: string | null;
  rating_avg: number | null;
  total_user_owns: number | null;
  total_root_owns: number | null;
  tags: string[] | null;
}

export interface PublicPath extends IndexablePath {
  slug: string;
  name: string;
  description: string | null;
  difficulty: string | null;
  module_count: number | null;
  machine_count: number | null;
  estimated_hours: number | null;
  released_at: string | null;
}

async function fetchList<T>(path: string): Promise<T[]> {
  try {
    const res = await fetch(`${GATEWAY}${path}`, {
      headers: { accept: "application/json" },
      next: { revalidate: REVALIDATE },
    });
    if (!res.ok) return [];
    const body: unknown = await res.json();
    if (body && typeof body === "object" && Array.isArray((body as { items?: unknown }).items)) {
      return (body as { items: T[] }).items;
    }
    return [];
  } catch {
    // Deliberately silent: see the "non-fatal" note above. A crawler asking for
    // the sitemap while a service restarts should get the static half of it,
    // not a 500 it will remember.
    return [];
  }
}

/** Public CTF events that pass the indexing gate, newest first. */
export async function indexableEvents(): Promise<PublicEvent[]> {
  const items = await fetchList<PublicEvent>("/v1/ctf/events?limit=200");
  return items
    .filter(isIndexableEvent)
    .sort((a, b) => (b.starts_at ?? "").localeCompare(a.starts_at ?? ""));
}

/** Every public event, gate or not — the listing page shows more than the
 *  sitemap submits, because a visitor browsing is not a crawler indexing. */
export async function publicEvents(): Promise<PublicEvent[]> {
  const items = await fetchList<PublicEvent>("/v1/ctf/events?limit=200");
  return items
    .filter((e) => e.visibility === "public" && !e.invitation_only)
    .sort((a, b) => (b.starts_at ?? "").localeCompare(a.starts_at ?? ""));
}

export async function indexableMachines(): Promise<PublicMachine[]> {
  const items = await fetchList<PublicMachine>("/v1/machines?limit=200");
  return items.filter(isIndexableMachine);
}

export async function indexablePaths(): Promise<PublicPath[]> {
  const items = await fetchList<PublicPath>("/v1/paths?limit=200");
  return items.filter(isIndexablePath);
}

/**
 * A single row by slug.
 *
 * The gateway keys these endpoints on a UUID and exposes the slug lookup under
 * a separate `by-slug/` segment — passing a slug to the id route returns a 400
 * from the UUID parser rather than a 404, which is why this cannot just
 * interpolate into the collection path.
 */
async function fetchOne<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${GATEWAY}${path}`, {
      headers: { accept: "application/json" },
      next: { revalidate: REVALIDATE },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function eventBySlug(slug: string): Promise<PublicEvent | null> {
  return fetchOne<PublicEvent>(`/v1/ctf/events/by-slug/${encodeURIComponent(slug)}`);
}

export function machineBySlug(slug: string): Promise<PublicMachine | null> {
  return fetchOne<PublicMachine>(`/v1/machines/by-slug/${encodeURIComponent(slug)}`);
}

export function pathBySlug(slug: string): Promise<PublicPath | null> {
  return fetchOne<PublicPath>(`/v1/paths/by-slug/${encodeURIComponent(slug)}`);
}

/**
 * The admin-curated order of ids for a marketing surface, or an empty array
 * when nothing has been featured (in which case the page shows everything).
 */
export async function featuredIds(
  surface: "landing_machines" | "labs_page" | "ctf_page",
): Promise<string[]> {
  try {
    const res = await fetch(`${GATEWAY}/v1/content/featured?surface=${surface}`, {
      headers: { accept: "application/json" },
      next: { revalidate: REVALIDATE },
    });
    if (!res.ok) return [];
    const body: unknown = await res.json();
    const items = (body as { items?: { item_id?: string }[] }).items;
    return Array.isArray(items) ? items.map((i) => String(i.item_id)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/**
 * Keep only the featured items, in the admin's order. With no featured ids the
 * full list is returned unchanged, so curation is an optional overlay.
 */
export function orderByFeatured<T>(items: T[], ids: string[], getId: (t: T) => string): T[] {
  if (ids.length === 0) return items;
  const rank = new Map(ids.map((id, i) => [id, i] as const));
  return items
    .filter((t) => rank.has(getId(t)))
    .sort((a, b) => (rank.get(getId(a)) ?? 0) - (rank.get(getId(b)) ?? 0));
}
