/**
 * The conference cluster.
 *
 * OFFCON is a platform and a conference, and the conference is the half that
 * carries the "advanced research" and "zero-day" queries the platform pages
 * cannot honestly claim. This page is content-led rather than data-led: there
 * is no ticketing service behind it yet, so every call to action routes to
 * /contact for the CFP and for sponsorship, and nothing here invents a date, an
 * attendance figure, a sponsor logo or a speaker name. Those are the fabrications
 * that turn an aspirational page into a liability the first time a reader checks
 * one - so the copy describes what the conference is *for* and who it is *for*,
 * and leaves the specifics to a real edition.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Crosshair, Bug, ShieldAlert, Mic, Globe2, GraduationCap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Faq, type QA } from "@/components/seo/faq";
import { JsonLd } from "@/components/seo/json-ld";
import { CLUSTERS, absolute } from "@/lib/seo/config";
import {
  breadcrumbNode,
  graph,
  organizationNode,
  webPageNode,
  websiteNode,
} from "@/lib/seo/jsonld";

const C = CLUSTERS.conference;

export const metadata: Metadata = {
  title: C.title,
  description: C.description,
  alternates: { canonical: absolute(C.path) },
  openGraph: {
    title: C.title,
    description: C.description,
    url: absolute(C.path),
    type: "website",
  },
};

const TRACKS = [
  {
    icon: Crosshair,
    title: "Red teaming & adversary simulation",
    body: "Full-scope operations against real defences: initial access, evasion, lateral movement, and the tradecraft that separates a checklist pentest from an operation a blue team actually has to work to catch.",
  },
  {
    icon: ShieldAlert,
    title: "Zero-day & vulnerability research",
    body: "Original findings, disclosed responsibly. New bug classes, novel exploitation of old ones, and the process of taking a vulnerability from a crash to a working, reliable primitive.",
  },
  {
    icon: Bug,
    title: "Exploit development",
    body: "Memory corruption, browser and kernel exploitation, sandbox escapes, and the mitigations each one has to defeat — the deep end of the field, presented by the people living in it.",
  },
  {
    icon: Globe2,
    title: "Cloud, mobile & hardware",
    body: "Attacks on the surfaces the industry actually ships on now: cloud identity and misconfiguration, mobile and app security, and hardware and firmware teardown.",
  },
];

const AUDIENCE = [
  {
    icon: Mic,
    title: "Researchers with something new",
    body: "The stage is for original work. If you have a finding, a technique, or a tool the field has not seen, the call for papers is how it gets here.",
  },
  {
    icon: Globe2,
    title: "Engineers from major technology companies",
    body: "Security teams from large technology firms come to see what is coming at them next — the research presented here is the early warning for the defences they will have to build.",
  },
  {
    icon: GraduationCap,
    title: "Pakistan's security community",
    body: "Students, CTF players, independent researchers and the country's growing professional scene — the conference is where Pakistani talent meets the international field on the same stage.",
  },
];

const FAQ: QA[] = [
  {
    q: "What is the OFFCON conference?",
    a: "It is an offensive-security conference: a stage for advanced, hands-on research rather than vendor talks. The material is the real work of the field — red teaming, exploit development, and zero-day vulnerability research — presented by the people who did it, for an audience that does it too.",
  },
  {
    q: "Who attends?",
    a: "Offensive security researchers and red teamers, security engineers from major technology companies, and Pakistan's own security community — students, CTF competitors and independent researchers. The point of putting them in one room is that the local scene meets the international field on equal footing.",
  },
  {
    q: "How do I submit a talk?",
    a: "Through the call for papers. If you have original research — a new technique, a zero-day, a tool, a piece of tradecraft the field has not seen — get in touch and we will send you the CFP details and timeline. Talks are selected on the substance of the work, not on where you are from or who you work for.",
  },
  {
    q: "Can my company sponsor or send a team?",
    a: "Yes. Sponsorship and group attendance for security teams are both available — contact us and we will walk you through the options. Companies also use the conference to recruit, since the room is full of people who can demonstrably do the work.",
  },
  {
    q: "Is the research disclosed responsibly?",
    a: "Yes. Zero-day and vulnerability research presented here follows responsible-disclosure norms — affected vendors are notified and given time to remediate before anything is presented publicly. The conference is a place to advance the field, not to drop live weapons on unpatched systems.",
  },
  {
    q: "How does this connect to the CTF platform?",
    a: "The competition and the conference are two halves of the same thing. The CTF arena is where skill is built and proven; the conference is where the people who have built it present what they have found. Placing well in OFFCON events is one of the ways new researchers get noticed for the stage.",
  },
];

export default function ConferencePage() {
  return (
    <div className="mx-auto max-w-[1200px] px-6 py-20">
      <JsonLd
        data={graph(
          organizationNode(),
          websiteNode(),
          webPageNode(C.path, C.title, C.description),
          breadcrumbNode([
            { name: "Home", path: "/" },
            { name: "Conference", path: C.path },
          ]),
        )}
      />

      <div className="max-w-[860px]">
        <div className="mb-3.5 text-[13px] font-bold uppercase tracking-[2.5px] text-accent">
          Conference
        </div>
        <h1 className="font-display text-[clamp(38px,5vw,58px)] font-extrabold leading-[1.05] tracking-[-1.5px]">
          {C.h1}
        </h1>
        <p className="mt-6 max-w-[720px] text-[18.5px] text-text-dim">
          OFFCON is a platform and a conference. The conference is the stage: advanced offensive
          research — red teaming, exploit development and zero-day disclosure — presented by the
          people who did the work, to an audience that does it too. It is where researchers from
          major technology companies and Pakistan&apos;s security community end up in the same room.
        </p>
        <div className="mt-9 flex flex-wrap gap-3">
          <Link href="/contact">
            <Button size="lg">Submit a talk (CFP)</Button>
          </Link>
          <Link href="/contact">
            <Button size="lg" variant="ghost">
              Sponsor or attend
            </Button>
          </Link>
        </div>
      </div>

      <section className="mt-24">
        <h2 className="font-display text-[clamp(26px,3.2vw,38px)] font-bold tracking-[-0.8px]">
          What gets presented
        </h2>
        <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-2">
          {TRACKS.map((t) => {
            const Icon = t.icon;
            return (
              <Card tilt key={t.title} className="p-7">
                <div className="mb-5 grid h-[52px] w-[52px] place-items-center border border-line bg-brand-gradient shadow-glow">
                  <Icon className="h-[26px] w-[26px] text-white" strokeWidth={1.9} />
                </div>
                <h3 className="mb-2.5 font-display text-[20px] font-semibold">{t.title}</h3>
                <p className="text-[14.8px] leading-[1.7] text-text-dim">{t.body}</p>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="mt-24">
        <h2 className="font-display text-[clamp(26px,3.2vw,38px)] font-bold tracking-[-0.8px]">
          Who is in the room
        </h2>
        <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-3">
          {AUDIENCE.map((a) => {
            const Icon = a.icon;
            return (
              <Card tilt key={a.title} className="p-7">
                <div className="mb-5 grid h-[52px] w-[52px] place-items-center border border-line bg-brand-gradient-soft">
                  <Icon className="h-[26px] w-[26px] text-accent" strokeWidth={1.9} />
                </div>
                <h3 className="mb-2.5 font-display text-[18px] font-semibold">{a.title}</h3>
                <p className="text-[14.5px] leading-[1.7] text-text-dim">{a.body}</p>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="mt-24 max-w-[760px]">
        <h2 className="font-display text-[clamp(26px,3.2vw,38px)] font-bold tracking-[-0.8px]">
          Why it is here
        </h2>
        <p className="prose-reading mt-6 text-[16.5px] leading-[1.8] text-text-dim">
          Pakistan produces serious offensive-security talent, and for a long time the only stages
          worth presenting on were on the other side of the world. The point of running a conference
          of this kind here is to remove that distance — to put local researchers, students and CTF
          players in the same room as the international field, presenting to the same audience,
          judged by the same standard.
        </p>
        <p className="prose-reading mt-4 text-[16.5px] leading-[1.8] text-text-dim">
          The work does not get diluted to make that happen. The bar is original research, disclosed
          responsibly, that advances the field — the same bar the rest of the world holds. What
          changes is only who gets a fair shot at meeting it.
        </p>
      </section>

      <Faq items={FAQ} path={C.path} title="Conference questions, answered" />

      <div className="bracket-frame mt-24 px-6 py-16 text-center md:px-16">
        <h2 className="font-display text-[clamp(28px,4.4vw,56px)] font-extrabold uppercase leading-[0.95] tracking-mega">
          Present your <span className="text-gradient">research</span>.
        </h2>
        <p className="mx-auto mt-6 max-w-[460px] text-[13px] leading-[1.8] text-text-dim">
          If you have original work, the call for papers is how it reaches the stage. If you want to
          sponsor, recruit or bring a team, we will set it up.
        </p>
        <Link href="/contact" className="mt-9 inline-block">
          <Button size="lg">Get in touch</Button>
        </Link>
      </div>
    </div>
  );
}
