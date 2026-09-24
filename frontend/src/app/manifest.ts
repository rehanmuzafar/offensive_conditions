/**
 * The web app manifest.
 *
 * Not a ranking factor on its own. It is here because Lighthouse's PWA and
 * best-practices audits both check for one, and those scores are what a
 * prospective partner or a directory listing tends to quote back at you — and
 * because `theme_color` is what stops Chrome on Android painting its own white
 * bar above a page whose own ground is near-black.
 *
 * Colours are read from the same tokens the root layout uses for
 * `<meta name="theme-color">`, so the two cannot disagree.
 */

import type { MetadataRoute } from "next";

import { BRAND } from "@/config/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${BRAND.name} — ${BRAND.fullName}`,
    short_name: BRAND.name,
    description: BRAND.tagline,
    start_url: "/",
    display: "standalone",
    background_color: "#070710",
    theme_color: "#070710",
    categories: ["education", "security", "productivity"],
    icons: [
      {
        src: "/offcon-mark.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/favicon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
