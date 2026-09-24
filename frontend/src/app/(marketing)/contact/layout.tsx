/**
 * Metadata for the contact page. Same reason as `/pricing` — the page itself is
 * a client component (it holds the form state), so its `metadata` export would
 * be ignored. See the note in `../pricing/layout.tsx`.
 */

import type { Metadata } from "next";

import { absolute } from "@/lib/seo/config";

const title = "Contact — Sales, Education, Press and Partnerships";
const description =
  "Talk to OFFCON about team seats, university and society events, press enquiries or partnerships. We answer from a real address, not a ticket queue.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: absolute("/contact") },
  openGraph: { title, description, url: absolute("/contact"), type: "website" },
};

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
