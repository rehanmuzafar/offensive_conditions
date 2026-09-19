import type { Metadata } from "next";

import { JsonLd } from "@/components/seo/json-ld";
import { absolute } from "@/lib/seo/config";
import { graph, organizationNode, webPageNode, websiteNode } from "@/lib/seo/jsonld";

import Hero from "@/components/landing/sections/Hero";
import Metrics from "@/components/landing/sections/Metrics";
import Arena from "@/components/landing/sections/Arena";
import Machines from "@/components/landing/sections/Machines";
import Ladder from "@/components/landing/sections/Ladder";
import Enlist from "@/components/landing/sections/Enlist";

export const metadata: Metadata = {
  /* `absolute` bypasses the root layout's "%s · OFFCON" template — on the front
     door the brand name should appear once, not twice. */
  title: { absolute: "OFFCON — Offensive Conditions" },
  description:
    "The arena where ethical hackers are forged. Hands-on labs, live CTF competitions and battle-ready machines in isolated sandboxes.",
  alternates: { canonical: absolute("/") },
};

/**
 * All figures on this page are still static. Wiring them to the real services
 * (season, machine counts, ladder, pricing) is tracked separately — see
 * HANDOFF-PROMPT.md in the landing repo for the per-section inventory.
 */
export default function LandingPage() {
  return (
    <>
      {/* The site-wide graph is emitted here rather than in the root layout,
          and deliberately. The layout wraps every surface including the ones
          robots.ts closes off, so putting it there would describe the same
          organisation on dozens of noindex login shells — repetition that adds
          nothing and has to be crawled anyway. The front door is the page whose
          entity resolution actually matters. */}
      <JsonLd
        data={graph(
          organizationNode(),
          websiteNode(),
          webPageNode(
            "/",
            "OFFCON — Offensive Conditions",
            "Hands-on offensive security: vulnerable machines, live CTF competitions, guided tracks and real bug bounties.",
          ),
        )}
      />
      <Hero />
      <Metrics />
      <Arena />
      <Machines />
      <Ladder />
      <Enlist />
    </>
  );
}
