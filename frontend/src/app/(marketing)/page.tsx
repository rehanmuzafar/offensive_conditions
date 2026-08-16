import Link from "next/link";
import {
  ArrowRight,
  Server,
  Flag as FlagIcon,
  Route,
  MessagesSquare,
  FileText,
  Target,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { HomeStats, HomeHallOfFame } from "./_components/live-sections";

const FEATURES = [
  { icon: Server, title: "Vulnerable machines", body: "Spin up isolated boxes and root real targets in gVisor-sandboxed labs with one click." },
  { icon: FlagIcon, title: "Live CTF arena", body: "Jeopardy & attack-defense events with real-time scoring and first-blood alerts." },
  { icon: Route, title: "Guided tracks", body: "Beginner-to-elite learning paths with hands-on, gated modules that build real skill." },
  { icon: MessagesSquare, title: "Community forum", body: "Trade tradecraft with a global community. Get unstuck, share nudges, level up together." },
  { icon: FileText, title: "Writeups", body: "Publish and read solution writeups — unlocked only after you legitimately root the box." },
  { icon: Target, title: "Bug bounties", body: "Hunt real vulnerabilities in live programs and earn cash bounties paid straight out." },
];

export default function LandingPage() {
  return (
    <>
      {/* HERO */}
      <section className="mx-auto grid max-w-[1200px] grid-cols-1 items-center gap-14 px-6 pb-16 pt-20 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="animate-fade-up">
          <Badge tone="brand" dot className="mb-6">
            Season 7 live · 86 active CTFs
          </Badge>
          <h1 className="font-display text-[clamp(40px,5.4vw,62px)] font-extrabold leading-[1.04] tracking-[-1.5px]">
            Forge yourself in <span className="text-gradient">offensive security</span>.
          </h1>
          <p className="mt-5 max-w-[540px] text-[18.5px] text-text-dim">
            Hands-on labs, live CTF competitions, and battle-ready machines. Train
            against real vulnerable systems, capture flags, and climb the global ranks.
          </p>
          <div className="mt-8 flex flex-wrap gap-3.5">
            <Link href="/register">
              <Button size="lg">
                Start hacking — free <ArrowRight className="h-[18px] w-[18px]" />
              </Button>
            </Link>
            <Link href="/machines">
              <Button size="lg" variant="ghost">
                Explore machines
              </Button>
            </Link>
          </div>
          <div className="mt-9 flex items-center gap-4 text-[13.5px] text-text-faint">
            <div className="flex">
              {["from-brand-purple-light to-brand-purple-dark", "from-brand-blue-light to-brand-blue-dark", "from-violet-400 to-violet-700", "from-cyan-400 to-blue-600"].map((g, i) => (
                <span key={i} className={`-ml-2.5 h-[30px] w-[30px] rounded-full border-2 border-bg bg-gradient-to-br ${g} first:ml-0`} />
              ))}
            </div>
            <span>
              Trusted by <b className="text-text">128,000+</b> hackers worldwide
            </span>
          </div>
        </div>

        {/* hero terminal card */}
        <Card variant="glass" className="animate-fade-up overflow-hidden shadow-card-lg">
          <div className="flex items-center gap-2 border-b border-line bg-black/25 px-4 py-3">
            <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
            <span className="ml-2 font-mono text-[12.5px] text-text-faint">
              root@offcon: ~/targets/sentinel
            </span>
          </div>
          <div className="space-y-1 p-5 font-mono text-[13px] leading-[1.9]">
            <div><span className="text-success">offcon@arena</span>:<span className="text-info">~</span>$ <span className="text-accent">box spawn sentinel</span></div>
            <div className="text-text-dim">→ provisioning gVisor sandbox…</div>
            <div className="my-2 h-1.5 overflow-hidden rounded bg-accent-soft/20">
              <div className="h-full w-[78%] rounded bg-brand-gradient" />
            </div>
            <div className="text-text-dim">→ target up at <span className="text-info">10.10.14.7</span> · vpn <span className="text-success">connected</span></div>
            <div><span className="text-success">offcon@arena</span>:<span className="text-info">~</span>$ <span className="text-accent">submit OFFCON&#123;r00t_d4nce&#125;</span></div>
            <div><span className="text-success">✓ user flag accepted</span> · <span className="text-warning">+25 pts</span></div>
            <div><span className="text-success">✓ root flag accepted</span> · <span className="text-warning">🩸 first blood +50</span></div>
            <div>
              <span className="text-success">offcon@arena</span>:<span className="text-info">~</span>${" "}
              <span className="inline-block h-[15px] w-2 translate-y-[2px] animate-blink bg-accent-soft" />
            </div>
          </div>
        </Card>
      </section>

      {/* STATS */}
      <section className="mx-auto max-w-[1200px] px-6 pb-16">
        <HomeStats />
      </section>

      {/* FEATURES */}
      <section id="features" className="mx-auto max-w-[1200px] px-6 py-16">
        <div className="mx-auto mb-12 max-w-[640px] text-center">
          <div className="mb-3.5 text-[13px] font-bold uppercase tracking-[2.5px] text-accent">
            The arena
          </div>
          <h2 className="font-display text-[clamp(30px,3.6vw,42px)] font-bold leading-[1.1] tracking-[-1px]">
            Everything you need to go from script-kiddie to operator
          </h2>
          <p className="mt-4 text-[17px] text-text-dim">
            One platform for hands-on offensive training — labs, competitions,
            community, and real bounties.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <Card key={f.title} interactive className="group p-7">
                <div className="mb-5 grid h-[52px] w-[52px] place-items-center rounded-[13px] bg-brand-gradient shadow-glow">
                  <Icon className="h-[26px] w-[26px] text-white" strokeWidth={1.9} />
                </div>
                <h3 className="mb-2.5 font-display text-[20px] font-semibold">{f.title}</h3>
                <p className="text-[14.8px] text-text-dim">{f.body}</p>
                <span className="mt-4 inline-flex items-center gap-1.5 text-[14px] font-semibold text-accent opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100 -translate-x-1.5">
                  Learn more <ArrowRight className="h-4 w-4" />
                </span>
              </Card>
            );
          })}
        </div>
      </section>

      {/* HALL OF FAME */}
      <section id="hof" className="mx-auto max-w-[1200px] px-6 py-16">
        <div className="mx-auto mb-12 max-w-[640px] text-center">
          <div className="mb-3.5 text-[13px] font-bold uppercase tracking-[2.5px] text-accent">
            Hall of fame
          </div>
          <h2 className="font-display text-[clamp(30px,3.6vw,42px)] font-bold tracking-[-1px]">
            The global leaderboard
          </h2>
          <p className="mt-4 text-[17px] text-text-dim">
            Top operators this season, ranked by points across machines, challenges, and CTFs.
          </p>
        </div>

        <HomeHallOfFame />
      </section>

      {/* FINAL CTA */}
      <section className="mx-auto max-w-[1200px] px-6 py-8">
        <div className="relative overflow-hidden rounded-3xl bg-brand-gradient px-10 py-16 text-center">
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.08) 1px,transparent 1px)",
              backgroundSize: "42px 42px",
              maskImage: "radial-gradient(ellipse at center,#000,transparent 75%)",
              WebkitMaskImage: "radial-gradient(ellipse at center,#000,transparent 75%)",
            }}
          />
          <div className="relative">
            <h2 className="font-display text-[clamp(30px,4vw,46px)] font-extrabold tracking-[-1px] text-white">
              Your first box is waiting.
            </h2>
            <p className="mx-auto mt-4 max-w-[520px] text-[18px] text-white/85">
              Create a free account, connect to the VPN, and root your first machine
              in the next 20 minutes.
            </p>
            <Link href="/register" className="mt-7 inline-block">
              <Button variant="white" size="lg">
                Create free account
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
