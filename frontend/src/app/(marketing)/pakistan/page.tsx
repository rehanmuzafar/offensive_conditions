/**
 * The Pakistan page.
 *
 * The rest of the site reads as international on purpose — a Pakistan framing
 * on `/` would cost every global query. This page carries the local signal
 * instead, where it can win queries the global copy never would: "CTF
 * Pakistan", "cyber security course Pakistan", "bug bounty Pakistan" and the
 * city variants. Those have a fraction of the volume of the bare terms and a
 * fraction of the competition, which is the trade that makes them winnable now
 * rather than in three years.
 *
 * Every local claim below is one the platform actually delivers today: fees
 * quoted and charged in rupees through a local gateway, and a per-country
 * ranking that exists in the scoring service. Nothing here asserts a
 * partnership, an accreditation or a user count, because inventing local proof
 * is both dishonest and the fastest way to lose the trust this page is trying
 * to build.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Wallet, Trophy, Globe2, GraduationCap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Faq, type QA } from "@/components/seo/faq";
import { JsonLd } from "@/components/seo/json-ld";
import { CLUSTERS, SITE, absolute } from "@/lib/seo/config";
import {
  breadcrumbNode,
  graph,
  organizationNode,
  webPageNode,
  websiteNode,
} from "@/lib/seo/jsonld";

const C = CLUSTERS.pakistan;

export const metadata: Metadata = {
  title: C.title,
  description: C.description,
  alternates: {
    canonical: absolute(C.path),
    // Declares the audience rather than a translation — the page is English,
    // written for readers in Pakistan. A `hreflang` pair needs a counterpart
    // to point back, and the global pages are the counterpart here.
    languages: { "en-PK": absolute(C.path) },
  },
  openGraph: {
    title: C.title,
    description: C.description,
    url: absolute(C.path),
    type: "website",
    locale: "en_PK",
  },
};

const LOCAL = [
  {
    icon: Wallet,
    title: "Priced in rupees",
    body: "Subscriptions and CTF entry fees are quoted and charged in PKR through a local payment gateway, so you are not paying a card's foreign-transaction margin on top of a dollar price — and you are not blocked when a card refuses an international charge.",
  },
  {
    icon: Trophy,
    title: "A national ranking",
    body: "The scoring service ranks by country as well as globally. Your standing among hackers in Pakistan is its own board, which is a far more useful number early on than a global rank in the thousands.",
  },
  {
    icon: Globe2,
    title: "Built to be reachable",
    body: "Labs are reached over WireGuard rather than through a browser-only console, which holds up on the connections people actually have here. Machines are sized to spawn quickly rather than to look impressive in a spec sheet.",
  },
  {
    icon: GraduationCap,
    title: "For students and societies",
    body: "University societies running their own events can use the platform to host them — private events, team registration and a scoreboard, without building the infrastructure first. Get in touch and we will set it up.",
  },
];

const FAQ: QA[] = [
  {
    q: "Is there a CTF platform in Pakistan?",
    a: "Yes — OFFCON is built and run from Pakistan, and hosts CTF competitions open to competitors here and internationally. Entry fees are charged in rupees, the scoring service keeps a Pakistan-specific ranking alongside the global one, and university societies can run their own private events on the same infrastructure.",
  },
  {
    q: "How do I start learning ethical hacking in Pakistan?",
    a: "The barrier is almost never access to material — it is the absence of a legal system to practise on. Set up a Linux virtual machine, create a free account here, and start on the easy lab machines: they are deliberately breakable and you are authorised to attack them, which is true of nothing else you can reach from your own connection. From there the guided tracks give the sequence, and CTF events give you a clock and a scoreboard.",
  },
  {
    q: "Can I pay in PKR?",
    a: "Yes. Plans and CTF entry fees are quoted in rupees and charged through a local gateway, so there is no foreign-currency conversion and no dependence on a card that supports international payments.",
  },
  {
    q: "Are there cybersecurity jobs in Pakistan?",
    a: "There is real and growing demand — banks, fintechs, telcos and the software-export sector all hire for security work, and remote contracting for firms abroad is a common route out of a first local role. What almost every employer screens on is demonstrable hands-on ability, which is exactly what solved machines, published writeups and CTF placements are evidence of.",
  },
  {
    q: "Can my university or society run a CTF on OFFCON?",
    a: "Yes. Events can be created as private or invitation-only, with team registration, per-team challenge instances and a live scoreboard, so a society can run an internal competition without standing up infrastructure. Contact us and we will help set the event up.",
  },
  {
    q: "Do I need to be in Pakistan to use OFFCON?",
    a: "No. The platform is open internationally and most of it is not country-specific at all — the local payment option and the national ranking are additions for competitors here, not restrictions on anyone else.",
  },
];

export default function PakistanPage() {
  return (
    <div className="mx-auto max-w-[1200px] px-6 py-20">
      <JsonLd
        data={graph(
          // `areaServed` is the local signal in the graph. It sits on a copy of
          // the organization node scoped to this page rather than on the global
          // one, so the entity is not narrowed to a single country everywhere
          // else on the site.
          { ...organizationNode(), areaServed: { "@type": "Country", name: "Pakistan" } },
          websiteNode(),
          webPageNode(C.path, C.title, C.description),
          breadcrumbNode([
            { name: "Home", path: "/" },
            { name: "Pakistan", path: C.path },
          ]),
        )}
      />

      <div className="max-w-[820px]">
        <div className="mb-3.5 text-[13px] font-bold uppercase tracking-[2.5px] text-accent">
          Pakistan
        </div>
        <h1 className="font-display text-[clamp(38px,5vw,58px)] font-extrabold leading-[1.05] tracking-[-1.5px]">
          {C.h1}
        </h1>
        <p className="mt-6 max-w-[680px] text-[18.5px] text-text-dim">
          {SITE.name} is an offensive security platform built and run from Pakistan: live CTF
          competitions, hands-on hacking labs and bug bounty practice — priced in rupees, with a
          national leaderboard alongside the global one.
        </p>
        <div className="mt-9 flex flex-wrap gap-3">
          <Link href="/register">
            <Button size="lg">Create a free account</Button>
          </Link>
          <Link href={CLUSTERS.ctf.path}>
            <Button size="lg" variant="ghost">
              See CTF events
            </Button>
          </Link>
        </div>
      </div>

      <section className="mt-24">
        <h2 className="font-display text-[clamp(26px,3.2vw,38px)] font-bold tracking-[-0.8px]">
          What is different for competitors here
        </h2>
        <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-2">
          {LOCAL.map((f) => {
            const Icon = f.icon;
            return (
              <Card tilt key={f.title} className="p-7">
                <div className="mb-5 grid h-[52px] w-[52px] place-items-center border border-line bg-brand-gradient shadow-glow">
                  <Icon className="h-[26px] w-[26px] text-white" strokeWidth={1.9} />
                </div>
                <h3 className="mb-2.5 font-display text-[20px] font-semibold">{f.title}</h3>
                <p className="text-[14.8px] leading-[1.7] text-text-dim">{f.body}</p>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="mt-24 max-w-[760px]">
        <h2 className="font-display text-[clamp(26px,3.2vw,38px)] font-bold tracking-[-0.8px]">
          Where to start
        </h2>
        <p className="prose-reading mt-6 text-[16.5px] leading-[1.8] text-text-dim">
          The thing that stops most people here is not the learning material, which is abundant and
          mostly free. It is that there is nowhere legal to practise. Reading about SQL injection
          for a month and then pointing a scanner at a site you do not own is how a promising start
          becomes a criminal record — the law in Pakistan, as almost everywhere, does not have an
          exception for curiosity.
        </p>
        <p className="prose-reading mt-4 text-[16.5px] leading-[1.8] text-text-dim">
          A lab removes that problem entirely. The machines here are built to be broken and you are
          authorised to break them, which makes them the only systems most beginners can legally
          attack. Start on an easy Linux box, get comfortable being stuck, and let the guided
          tracks supply the order. When you want a clock and other people, enter a CTF.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href={CLUSTERS.labs.path}>
            <Button variant="ghost">Browse the labs</Button>
          </Link>
          <Link href={CLUSTERS.training.path}>
            <Button variant="ghost">See the tracks</Button>
          </Link>
        </div>
      </section>

      <Faq items={FAQ} path={C.path} title="Questions from Pakistan" />

      <div className="bracket-frame mt-24 px-6 py-16 text-center md:px-16">
        <h2 className="font-display text-[clamp(28px,4.4vw,56px)] font-extrabold uppercase leading-[0.95] tracking-mega">
          Start where you <span className="text-gradient">are</span>.
        </h2>
        <p className="mx-auto mt-6 max-w-[440px] text-[13px] leading-[1.8] text-text-dim">
          Free account, rupee pricing when you upgrade, and a leaderboard with your country on it.
        </p>
        <Link href="/register" className="mt-9 inline-block">
          <Button size="lg">Create an account</Button>
        </Link>
      </div>
    </div>
  );
}
