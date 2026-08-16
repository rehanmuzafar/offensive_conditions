import type { Metadata } from "next";
import Link from "next/link";
import {
  Server,
  Flag,
  Route,
  MessagesSquare,
  FileText,
  Target,
  ShieldCheck,
  Network,
  Trophy,
  Zap,
  Lock,
  Globe,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/layout/section-heading";

export const metadata: Metadata = {
  title: "Features",
  description:
    "Everything OFFCON gives you: vulnerable machines, live CTF, guided tracks, forum, writeups, bug bounties, and the infrastructure behind it all.",
};

const PILLARS = [
  { icon: Server, title: "Vulnerable machines", body: "Hundreds of boxes across Linux, Windows, and Active Directory. Spin one up in seconds — each isolated in its own gVisor sandbox." },
  { icon: Flag, title: "Live CTF arena", body: "Jeopardy and attack-defense competitions with real-time scoreboards, first-blood alerts, and seasonal championships." },
  { icon: Route, title: "Guided tracks", body: "Structured paths from your first nmap scan to advanced binary exploitation, each with hands-on, gated modules." },
  { icon: MessagesSquare, title: "Community forum", body: "A global community trading tradecraft, nudges (never spoilers), and war stories. Get unstuck and give back." },
  { icon: FileText, title: "Writeups", body: "Read and publish polished walkthroughs — automatically unlocked the moment you legitimately root a box." },
  { icon: Target, title: "Bug bounties", body: "Take your skills to real targets. Hunt vulnerabilities in live programs and earn cash bounties paid straight out." },
];

const INFRA = [
  { icon: ShieldCheck, title: "Isolated by default", body: "Every lab runs sandboxed and network-segmented. Your exploits never touch another user." },
  { icon: Network, title: "Private VPN", body: "Connect over WireGuard to dedicated regional servers with low latency anywhere." },
  { icon: Zap, title: "Instant spawns", body: "No waiting in queues. Machines provision in seconds and tear down cleanly." },
  { icon: Trophy, title: "Fair scoring", body: "Dynamic points, anti-cheat flag rotation, and per-user flags keep the leaderboard honest." },
  { icon: Lock, title: "Account security", body: "2FA, WebAuthn, session management, and per-device controls baked in." },
  { icon: Globe, title: "195 countries", body: "A truly global arena. Compete and climb against the best, wherever you are." },
];

export default function FeaturesPage() {
  return (
    <div className="mx-auto max-w-[1200px] px-6 py-20">
      <SectionHeading
        eyebrow="Features"
        title="One arena. Every discipline."
        subtitle="OFFCON brings hands-on labs, competitions, community, and real bounties together in a single platform."
      />

      {/* pillars */}
      <div className="mt-14 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
        {PILLARS.map((f) => {
          const Icon = f.icon;
          return (
            <Card key={f.title} interactive className="p-7">
              <div className="mb-5 grid h-[52px] w-[52px] place-items-center rounded-[13px] bg-brand-gradient shadow-glow">
                <Icon className="h-[26px] w-[26px] text-white" strokeWidth={1.9} />
              </div>
              <h3 className="mb-2.5 font-display text-[20px] font-semibold">{f.title}</h3>
              <p className="text-[14.8px] text-text-dim">{f.body}</p>
            </Card>
          );
        })}
      </div>

      {/* infra band */}
      <div className="mt-24">
        <SectionHeading
          eyebrow="Under the hood"
          title="Built for real offensive work"
          subtitle="The infrastructure that makes hands-on hacking safe, fast, and fair."
        />
        <div className="mt-12 grid grid-cols-1 gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {INFRA.map((f) => {
            const Icon = f.icon;
            return (
              <div key={f.title} className="flex gap-4">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-gradient-soft">
                  <Icon className="h-[22px] w-[22px] text-accent" strokeWidth={1.9} />
                </div>
                <div>
                  <h4 className="font-display text-[16.5px] font-semibold">{f.title}</h4>
                  <p className="mt-1 text-[14px] text-text-dim">{f.body}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* cta */}
      <Card variant="glass" className="mt-24 overflow-hidden p-0">
        <div className="relative bg-brand-gradient px-10 py-14 text-center">
          <h2 className="font-display text-[clamp(28px,3.6vw,40px)] font-extrabold tracking-[-1px] text-white">
            See it for yourself.
          </h2>
          <p className="mx-auto mt-3 max-w-[480px] text-[17px] text-white/85">
            Create a free account and root your first machine today.
          </p>
          <Link href="/register" className="mt-7 inline-block">
            <Button variant="white" size="lg">Start hacking — free</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
