/**
 * Metadata for the pricing page.
 *
 * It lives in a layout because `page.tsx` is a client component — it holds the
 * monthly/annual toggle and reads the live plans through react-query — and a
 * `"use client"` module cannot export `metadata`. Next does not warn about
 * this; the export is simply ignored, which is why both this page and
 * `/contact` have been silently inheriting the root title and shipping
 * "OFFCON — Offensive Conditions" as the title of a pricing page.
 *
 * A layout around a single page is the standard way out: it stays a server
 * component, exports the metadata, and renders nothing of its own.
 */

import type { Metadata } from "next";

import { absolute } from "@/lib/seo/config";

const title = "Pricing — Free Tier, VIP and Team Plans";
const description =
  "Start free with lab access and community CTF events, or upgrade for the full machine catalogue, guided tracks and priority capacity. Local currency supported, including PKR.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: absolute("/pricing") },
  openGraph: { title, description, url: absolute("/pricing"), type: "website" },
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
