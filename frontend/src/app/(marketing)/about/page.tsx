import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { SectionHeading } from "@/components/layout/section-heading";

export const metadata: Metadata = {
  title: "About",
  description:
    "OFFCON exists to make world-class offensive security training hands-on, accessible, and relentless. Meet the mission behind the arena.",
};

const VALUES = [
  { title: "Hands-on or nothing", body: "You don't learn to hack by watching. Every lesson on OFFCON ends with you on a real, breakable system." },
  { title: "Merit over hype", body: "The leaderboard doesn't care where you're from or what's on your CV. It cares whether you rooted the box." },
  { title: "Defense through offense", body: "We train attackers so the world builds better defenses. Every operator we forge makes systems safer." },
  { title: "Open to everyone", body: "From a student in Lahore to a red-teamer in Berlin — a free tier, a global community, and no gatekeeping." },
];

const STATS = [
  { value: "128K", label: "Hackers trained" },
  { value: "540+", label: "Machines shipped" },
  { value: "2.4M", label: "Flags captured" },
  { value: "195", label: "Countries" },
];

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-[1200px] px-6 py-20">
      {/* hero */}
      <div className="mx-auto max-w-[760px] text-center">
        <h1 className="font-display text-[clamp(38px,5vw,58px)] font-extrabold leading-[1.05] tracking-[-1.5px]">
          We forge the people who <span className="text-gradient">break things</span> — so others can build them stronger.
        </h1>
        <p className="mx-auto mt-6 max-w-[620px] text-[18.5px] text-text-dim">
          OFFCON started with a simple frustration: offensive security was taught in slides and theory,
          while the real skill only came from doing. So we built the arena we wished we&apos;d had.
        </p>
      </div>

      {/* stats */}
      <div className="mt-16 grid grid-cols-2 gap-5 lg:grid-cols-4">
        {STATS.map((s) => (
          <Stat key={s.label} value={s.value} label={s.label} />
        ))}
      </div>

      {/* mission */}
      <div className="mt-24 grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
        <div>
          <SectionHeading align="left" eyebrow="Our mission" title="Make mastery the only barrier to entry." />
          <div className="mt-5 space-y-4 text-[16px] text-text-dim">
            <p>
              The best defenders think like attackers. But for most people, getting real offensive
              experience meant expensive courses, sketchy labs, or breaking things you shouldn&apos;t.
            </p>
            <p>
              OFFCON gives anyone — for free — a safe, legal, sandboxed place to attack real systems,
              compete in live CTFs, and prove themselves on a global leaderboard. No CV required. Just skill.
            </p>
            <p>
              Today, operators from 195 countries train here every day. Tomorrow, they&apos;re the people
              keeping the world&apos;s systems secure.
            </p>
          </div>
        </div>
        <Card variant="glass" className="overflow-hidden p-0">
          <div className="relative bg-brand-gradient p-10">
            <div
              className="absolute inset-0"
              style={{
                backgroundImage:
                  "linear-gradient(rgba(255,255,255,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.08) 1px,transparent 1px)",
                backgroundSize: "40px 40px",
                maskImage: "radial-gradient(ellipse at 70% 30%,#000,transparent 80%)",
                WebkitMaskImage: "radial-gradient(ellipse at 70% 30%,#000,transparent 80%)",
              }}
            />
            <blockquote className="relative font-display text-[24px] font-semibold leading-snug text-white">
              “The gap between knowing about security and doing security is enormous. OFFCON is a bridge across it.”
            </blockquote>
            <p className="relative mt-5 text-[14px] text-white/80">— The founding team</p>
          </div>
        </Card>
      </div>

      {/* values */}
      <div className="mt-24">
        <SectionHeading eyebrow="What we believe" title="The principles behind the platform" />
        <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-2">
          {VALUES.map((v) => (
            <Card key={v.title} className="p-7">
              <h3 className="font-display text-[19px] font-semibold">{v.title}</h3>
              <p className="mt-2.5 text-[15px] text-text-dim">{v.body}</p>
            </Card>
          ))}
        </div>
      </div>

      {/* cta */}
      <div className="mt-24 text-center">
        <SectionHeading title="Come prove yourself." subtitle="Join a global community of operators training every day." />
        <div className="mt-7 flex justify-center gap-3.5">
          <Link href="/register">
            <Button size="lg">Create free account</Button>
          </Link>
          <Link href="/careers">
            <Button size="lg" variant="ghost">We&apos;re hiring</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
