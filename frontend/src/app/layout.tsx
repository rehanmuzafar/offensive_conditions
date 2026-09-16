import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";

import { Providers } from "@/providers";
import { BRAND } from "@/config/brand";
import "@/styles/globals.css";
// flag-icons CSS is loaded via CDN <link> in <head> below (the packaged
// minified CSS trips the build's CSS parser, so we link it instead).

/**
 * Three families, three jobs.
 *
 *   Archivo (display) — headlines. A true 900 with flat terminals and narrow-ish
 *     proportions, which is what lets the display type set at -0.05em tracking
 *     without the counters closing up.
 *   IBM Plex Mono (mono) — the interface voice. Labels, navigation, numbers,
 *     tables, terminal output. Most of what you see is set in this.
 *   IBM Plex Sans (body) — long-form reading only, via `.prose-reading`. Same
 *     superfamily as the mono, so the two sit together without a seam.
 *
 * All three are loaded from ./fonts rather than next/font/google. The woff2
 * files come from the @fontsource packages and are vendored into the repo
 * (~200KB total), so neither the build nor the dev server reaches out to
 * fonts.gstatic.com. That keeps builds reproducible offline and behind a proxy,
 * and removes a third-party request from every page view. It is also a hard
 * requirement on at least one machine here, where gstatic is unreachable and
 * next/font/google hangs the build on retry loops.
 */
const display = localFont({
  src: [
    { path: "./fonts/archivo-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/archivo-latin-700-normal.woff2", weight: "700", style: "normal" },
    { path: "./fonts/archivo-latin-800-normal.woff2", weight: "800", style: "normal" },
    { path: "./fonts/archivo-latin-900-normal.woff2", weight: "900", style: "normal" },
  ],
  variable: "--font-display",
  display: "swap",
  fallback: ["Helvetica Neue", "Arial", "sans-serif"],
});

const mono = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-latin-300-normal.woff2", weight: "300", style: "normal" },
    { path: "./fonts/ibm-plex-mono-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-mono-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-mono-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-mono",
  display: "swap",
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
});

const body = localFont({
  src: [
    { path: "./fonts/ibm-plex-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-body",
  display: "swap",
  fallback: ["system-ui", "Segoe UI", "sans-serif"],
});

export const metadata: Metadata = {
  metadataBase: new URL(BRAND.siteUrl),
  title: {
    default: `${BRAND.name} — ${BRAND.fullName}`,
    template: `%s · ${BRAND.name}`,
  },
  description:
    "Hands-on offensive security training: vulnerable machines, live CTF competitions, guided tracks, and real bug bounties. Forge yourself in the arena.",
  applicationName: BRAND.fullName,
  keywords: [
    "offensive security",
    "ethical hacking",
    "CTF",
    "penetration testing",
    "vulnerable machines",
    "cybersecurity training",
    "bug bounty",
  ],
  icons: { icon: BRAND.favicon },
  manifest: "/manifest.webmanifest",
  /* Google Search Console ownership proof. Emitted as
     <meta name="google-site-verification">; the token names the property, is
     public by design, and must not be removed - Google re-checks it and
     unverifies the property if it disappears, which silently stops the sitemap
     being read. A second proof sits at public/google34f03d1861e80472.html. */
  verification: { google: "8MVf83D-vCLLU_NCAWXPLczXF45fIruO0dihBsYFFN4" },
  /* The apex is the canonical origin for everything public. Pages that need a
     different one override this; the value matters most for the pages that do
     *not*, because without it a page reachable at more than one URL — with a
     trailing slash, with a tracking parameter, on www — is several pages as far
     as Google is concerned, splitting whatever authority it has between them. */
  alternates: { canonical: "/" },
  /* `max-image-preview: large` is the one directive here with a visible effect:
     without it Google shows a thumbnail at most, and with it the generated share
     card can run as a full-width preview. The rest restate the defaults, which
     is worth doing explicitly on a site where most hostnames are noindex — it
     removes any question about what the public half is asking for. */
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    type: "website",
    url: BRAND.siteUrl,
    title: `${BRAND.name} — ${BRAND.fullName}`,
    description: BRAND.tagline,
    siteName: BRAND.fullName,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: `${BRAND.name} — ${BRAND.fullName}`,
    description: BRAND.tagline,
  },
  /* Stops Safari on iOS turning anything that resembles a phone number into a
     tel: link — the scoreboard and the machine pages are full of digit runs
     that are not phone numbers, and an autolinked one renders as blue text the
     stylesheet has no say over. */
  formatDetection: { telephone: false, address: false, email: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#070710" },
    { media: "(prefers-color-scheme: light)", color: "#FBFAFF" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: next-themes sets data-theme on <html> pre-paint
    <html
      lang="en"
      suppressHydrationWarning
      className={`${display.variable} ${mono.variable} ${body.variable}`}
    >
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/lipis/flag-icons@7.2.3/css/flag-icons.min.css"
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
