/**
 * The sitemap.
 *
 * A sitemap is a set of *recommendations*, not a list of everything that
 * resolves — which is why this is built from the indexing gate in
 * `lib/seo/indexable.ts` rather than from the full catalogue. Submitting a URL
 * and then serving it a `noindex` is a contradiction Google reports as an
 * error in Search Console, so the two have to agree, and they agree by both
 * asking the same predicate.
 *
 * `priority` is the least important field here and is widely misunderstood: it
 * is relative *within this file* and does not raise a page against anyone
 * else's. It is set anyway because it costs nothing and does express something
 * true — the landing pages matter more than a single retired machine.
 *
 * Every URL below must answer 200. A sitemap full of 404s is worse than no
 * sitemap: it is a direct quality signal about the domain, and it teaches the
 * crawler to come back less often.
 */

import type { MetadataRoute } from "next";

import { CLUSTERS, absolute } from "@/lib/seo/config";
import { indexableEvents, indexableMachines, indexablePaths } from "@/lib/seo/public-data";

/**
 * Rendered per request, not at build.
 *
 * The builder container cannot reach `edge:8080` - it runs on the default
 * bridge network, not the compose one - so anything prerendered during
 * `docker compose build` is prerendered against an unreachable gateway and
 * comes out empty. ISR would then hold that empty version for the whole
 * revalidate window, because a freshly built page is not stale.
 *
 * `fetchCache` keeps the per-fetch `revalidate` in `lib/seo/public-data.ts`
 * in effect, so this is one upstream call an hour shared across these routes,
 * not one per request.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "default-cache";

type Entry = MetadataRoute.Sitemap[number];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticPages: Entry[] = [
    { url: absolute("/"), lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: absolute(CLUSTERS.ctf.path), lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: absolute(CLUSTERS.labs.path), lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: absolute(CLUSTERS.training.path), lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: absolute(CLUSTERS.bounty.path), lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: absolute(CLUSTERS.pakistan.path), lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: absolute(CLUSTERS.conference.path), lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: absolute("/features"), lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: absolute("/pricing"), lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: absolute("/about"), lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: absolute("/contact"), lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];

  // Settled independently: one service being down should cost its own section
  // of the sitemap, not the whole file. `allSettled` over `all` is the whole
  // point — `all` would reject the first time ctf-svc restarted mid-crawl.
  const [events, machines, paths] = await Promise.allSettled([
    indexableEvents(),
    indexableMachines(),
    indexablePaths(),
  ]).then((rs) => rs.map((r) => (r.status === "fulfilled" ? r.value : [])));

  const eventPages: Entry[] = (events as Awaited<ReturnType<typeof indexableEvents>>).map((e) => ({
    url: absolute(`${CLUSTERS.ctf.path}/${e.slug}`),
    lastModified: e.updated_at ? new Date(e.updated_at) : now,
    // A live event's scoreboard moves constantly; a finished one never will.
    changeFrequency: e.status === "ended" ? ("yearly" as const) : ("hourly" as const),
    priority: e.status === "ended" ? 0.4 : 0.8,
  }));

  const machinePages: Entry[] = (machines as Awaited<ReturnType<typeof indexableMachines>>).map(
    (m) => ({
      url: absolute(`${CLUSTERS.labs.path}/${m.slug}`),
      lastModified: m.updated_at ? new Date(m.updated_at) : now,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    }),
  );

  const pathPages: Entry[] = (paths as Awaited<ReturnType<typeof indexablePaths>>).map((p) => ({
    url: absolute(`${CLUSTERS.training.path}/${p.slug}`),
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }));

  return [...staticPages, ...eventPages, ...machinePages, ...pathPages];
}
