/**
 * robots.txt, which has to differ per hostname.
 *
 * One Next app serves six hosts (see `middleware.ts`) and only the apex has
 * anything a crawler should keep. `dashboard.`, `app.`, `ctf.`, `bugbounty.`
 * and `admin.` all sit behind `AuthGuard`, so a crawler that reaches them gets
 * a login shell: the same ~20KB skeleton wearing the site's generic title, at
 * every path it tries. Left open, that is dozens of near-identical thin pages
 * competing with the handful of real ones, which is a reliable way to suppress
 * exactly what you wanted ranked.
 *
 * A static robots.txt cannot express that, because it is one file and the host
 * is a property of the request. Reading `headers()` makes this route dynamic,
 * which is the cost of getting it right — and it is a cheap route to render.
 *
 * Note this is *advisory*, not a security control. It keeps honest crawlers
 * out of the private surfaces; `AuthGuard` is what actually keeps people out.
 */

import type { MetadataRoute } from "next";
import { headers } from "next/headers";

import { DISALLOWED_PATHS, PRIVATE_SURFACES, SITE_URL, absolute } from "@/lib/seo/config";

export const dynamic = "force-dynamic";

/** The surface label in front of the root domain, if there is one. */
function labelOf(host: string): string {
  const name = (host.split(":")[0] ?? "").toLowerCase();
  const first = name.split(".")[0] ?? "";
  return first;
}

export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = (await headers()).get("host") ?? "";
  const label = labelOf(host);

  // Everything but the apex and `www` is a private surface. Checking the
  // allowlist rather than the denylist means a subdomain added later is
  // closed by default, which is the safer direction to be wrong in.
  const isPrivateSurface = (PRIVATE_SURFACES as readonly string[]).includes(label);

  if (isPrivateSurface) {
    return {
      rules: [{ userAgent: "*", disallow: "/" }],
      // Still point home, so a crawler that started here finds the public site.
      host: SITE_URL,
    };
  }

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [...DISALLOWED_PATHS],
      },
      // Next's build assets are fine to fetch — Googlebot needs the CSS and JS
      // to render the page and will flag a layout it cannot paint — but the
      // JSON payloads behind them are not pages and should not be crawled as
      // though they were.
      { userAgent: "*", disallow: ["/_next/data/"] },
    ],
    sitemap: absolute("/sitemap.xml"),
    host: SITE_URL,
  };
}
