import type { Metadata, Viewport } from "next";
import { Sora, Manrope, JetBrains_Mono } from "next/font/google";

import { Providers } from "@/providers";
import { BRAND } from "@/config/brand";
import "@/styles/globals.css";
// flag-icons CSS is loaded via CDN <link> in <head> below (the packaged
// minified CSS trips the build's CSS parser, so we link it instead).

/* Distinctive type pairing: Sora (display) + Manrope (body) + JetBrains (mono).
   Loaded as CSS variables so Tailwind's font-display/sans/mono map to them. */
const sora = Sora({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-display",
  display: "swap",
});
const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
});
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-mono",
  display: "swap",
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
  openGraph: {
    type: "website",
    url: BRAND.siteUrl,
    title: `${BRAND.name} — ${BRAND.fullName}`,
    description: BRAND.tagline,
    siteName: BRAND.fullName,
  },
  twitter: {
    card: "summary_large_image",
    title: `${BRAND.name} — ${BRAND.fullName}`,
    description: BRAND.tagline,
  },
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
      className={`${sora.variable} ${manrope.variable} ${jetbrains.variable}`}
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
