/**
 * ============================================================================
 *  OFFCON BRAND CONFIG  —  EDIT YOUR LOGO HERE
 * ============================================================================
 *
 *  👉  To use your REAL logo across the entire site, do TWO things:
 *
 *   1. Drop your logo files into the `public/` folder, e.g.
 *          public/logo.svg          (full logo: shield + "OFFCON" wordmark)
 *          public/logo-mark.svg      (just the shield, for tight spaces)
 *          public/favicon.ico
 *
 *   2. Update the paths below to point at them, e.g.
 *          logo:     "/logo.svg"
 *          logoMark: "/logo-mark.svg"
 *
 *  That's it. Every place a logo appears (top nav, footer, auth pages, emails,
 *  loading screen) reads from this one file via the <Logo /> component, so you
 *  never have to hunt through the codebase.
 *
 *  ── Until you set real files, `logo` / `logoMark` are left null and the
 *     <Logo /> component renders the built-in inline SVG placeholder (the
 *     same shield + wordmark you approved in the landing-page mockup).
 * ============================================================================
 */

export interface BrandConfig {
  /** Path to the full logo image (shield + wordmark). null = use inline SVG placeholder. */
  logo: string | null;
  /** Path to the mark-only image (shield). null = use inline SVG placeholder. */
  logoMark: string | null;
  /** Path to favicon (referenced from app metadata). */
  favicon: string;
  /** Short product name shown in the wordmark. */
  name: string;
  /** Full product name shown as the sub-label / in metadata. */
  fullName: string;
  /** Marketing tagline. */
  tagline: string;
  /** Canonical site origin (used for OG tags, canonical URLs). */
  siteUrl: string;
  /** Support / contact email. */
  contactEmail: string;
  /** Brand gradient stops, mirrored from the logo (purple → blue). */
  gradient: {
    purple: string;
    purpleDark: string;
    blue: string;
    blueDark: string;
  };
  /** Social links (footer + share). Empty string hides the icon. */
  social: {
    twitter: string;
    github: string;
    discord: string;
    linkedin: string;
  };
}

export const BRAND: BrandConfig = {
  // ⬇⬇⬇  REPLACE THESE TWO PATHS WITH YOUR REAL LOGO WHEN READY  ⬇⬇⬇
  logo: null, // e.g. "/logo.svg"
  logoMark: null, // e.g. "/logo-mark.svg"
  // ⬆⬆⬆  (left null → inline SVG placeholder renders automatically)  ⬆⬆⬆

  favicon: "/favicon.ico",
  name: "OFFCON",
  fullName: "Offensive Conditions",
  tagline: "Forge yourself in offensive security.",
  siteUrl: "https://offensiveconditions.org",
  contactEmail: "support@offensiveconditions.org",
  gradient: {
    purple: "#7C3AED",
    purpleDark: "#6D28D9",
    blue: "#2563EB",
    blueDark: "#1D4ED8",
  },
  social: {
    twitter: "https://twitter.com/offcon",
    github: "https://github.com/offcon",
    discord: "https://discord.gg/offcon",
    linkedin: "https://linkedin.com/company/offcon",
  },
};
