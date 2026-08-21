import type { Metadata } from "next";

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
};

/**
 * All figures on this page are still static. Wiring them to the real services
 * (season, machine counts, ladder, pricing) is tracked separately — see
 * HANDOFF-PROMPT.md in the landing repo for the per-section inventory.
 */
export default function LandingPage() {
  return (
    <>
      <Hero />
      <Metrics />
      <Arena />
      <Machines />
      <Ladder />
      <Enlist />
    </>
  );
}
