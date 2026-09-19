/**
 * The bug bounty cluster.
 *
 * Content-led rather than data-led, because there are no public programs yet
 * and a listing page with nothing in it ranks for nothing. What it can rank for
 * is the explanatory query — "how does bug bounty work", "bug bounty for
 * beginners", "how to write a bug bounty report" — which is where most of the
 * search volume in this cluster actually is, and which is answerable honestly
 * today.
 *
 * When programs do exist this page should grow a listing band above the
 * explainer, the way `/ctf-competitions` has one. The fetch is deliberately
 * already wired for that.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Target, FileText, ShieldCheck, Coins, Building2, GaugeCircle, UserCheck, Rocket } from "lucide-react";

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
import { link } from "@/lib/surfaces";

const C = CLUSTERS.bounty;

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

const PILLARS = [
  {
    icon: Target,
    title: "Scope you can read",
    body: "Every program states what is in scope, what is explicitly out, and which classes of finding it will not pay for. Reading that page properly is the single highest-value habit in bug bounty work — most rejected reports were out of scope before a single request was sent.",
  },
  {
    icon: FileText,
    title: "Reports with a structure",
    body: "A report is a claim plus the evidence for it: where the bug is, what an attacker gains, and the exact steps a triager can replay. Submissions here are structured so the parts a triager needs are required rather than hoped for.",
  },
  {
    icon: ShieldCheck,
    title: "Safe harbour, written down",
    body: "Each program carries an explicit safe-harbour statement setting out the testing it authorises. That statement is the difference between security research and a computer misuse offence, and it belongs in writing before you start, not after.",
  },
  {
    icon: Coins,
    title: "Paid on severity",
    body: "Bounties are set against the impact of the finding, assessed by the triage team and visible on the program page as a range before you start. Payouts are tracked to your account and paid out directly.",
  },
];

const WORKFLOW = [
  { step: "Pick a program", body: "Read its scope, its exclusions, and its safe-harbour terms. Match it against what you are actually good at — a program full of mobile targets is a poor fit if you have never opened a decompiler." },
  { step: "Recon", body: "Map the attack surface inside scope: subdomains, endpoints, parameters, authentication flows, roles. Most findings live in the part of an application nobody remembered to test." },
  { step: "Find and verify", body: "Confirm the bug is real and reproducible before writing it up, and establish what an attacker actually gains. A reproducible proof-of-concept is what separates a paid report from a closed one." },
  { step: "Report", body: "One finding per report. Location, impact, reproduction steps, and a suggested fix. Keep the proof-of-concept minimal — demonstrating impact is not the same as maximising damage." },
  { step: "Triage and payout", body: "The team validates, assigns severity, and pays against the program's range. If it is a duplicate you will be told what it duplicated and when that was received." },
];

const FOR_COMPANIES = [
  {
    icon: Rocket,
    title: "Launch a program",
    body: "Define your scope, your exclusions and your reward table, publish a safe-harbour statement, and open to researchers. Run it public or invite a vetted private pool — you decide who can test and what they can touch.",
  },
  {
    icon: GaugeCircle,
    title: "Triage you can trust",
    body: "Reports arrive structured — location, impact, reproduction — and are validated and severity-rated before they reach your engineers, so your team sees confirmed issues, not a queue of noise and duplicates.",
  },
  {
    icon: UserCheck,
    title: "Vetted researchers",
    body: "The same people who compete in the arena and place on the leaderboard are the ones testing your systems. You can gate a private program to a skill tier, so a critical asset is only ever in experienced hands.",
  },
  {
    icon: Coins,
    title: "Pay for impact, not hours",
    body: "You set the reward range per severity and pay only for valid, in-scope findings. No retainer, no per-hour billing — a bounty is cheaper than the breach it prevents and far cheaper than a pentest that finds nothing.",
  },
];

const FAQ: QA[] = [
  {
    q: "What is a bug bounty program?",
    a: "A standing offer from an organisation: test these systems, within these rules, and we will pay you for valid security findings. It converts what would otherwise be unauthorised testing into authorised research, because the scope document is the authorisation. The payment is for the finding's impact, not for the time you spent looking.",
  },
  {
    q: "Can a beginner earn from bug bounty?",
    a: "Yes, but be realistic about the curve. The first months are usually spent finding duplicates and out-of-scope issues, and that is normal — you are learning an application's shape as much as a vulnerability class. People who get through it tend to be the ones who picked one target and went deep rather than scanning fifty and moving on.",
  },
  {
    q: "Is bug bounty hunting legal?",
    a: "It is legal within the scope and safe-harbour terms of a program that has published them, and it is a criminal offence outside them in most jurisdictions — including testing a target that never invited it. Scope is not a formality. Read it, stay inside it, and stop if you find yourself somewhere it does not cover.",
  },
  {
    q: "How much do bug bounties pay?",
    a: "Across the industry, the range runs from tens of dollars for a low-severity issue to five figures for a critical one on a mature program, and the distribution is heavily skewed toward the low end. Each program on OFFCON publishes its own range on its page before you start, so you are never guessing.",
  },
  {
    q: "What should I practise before hunting on live targets?",
    a: "Web exploitation on real applications, until finding an injection or a broken access control is routine rather than lucky. The lab machines and the web modules in the guided tracks cover the same classes that make up most of what bounty programs pay for, without the risk of testing something you are not authorised to touch.",
  },
  {
    q: "We are a company — how do we start a program?",
    a: "Get in touch and we will set it up with you: scope and exclusions, a safe-harbour statement, a reward table by severity, and whether it runs public or as a private invite-only pool. You can start small — a tight scope on one asset — and widen it as you get comfortable with the flow of reports.",
  },
  {
    q: "What does a program cost to run?",
    a: "You pay the bounties you award for valid, in-scope findings, at the reward range you set, plus the platform's fee for hosting and triage. There is no per-hour billing — unlike a pentest, you are paying for outcomes, and an unfound bug costs you nothing.",
  },
];

export default function BugBountyPage() {
  return (
    <div className="mx-auto max-w-[1200px] px-6 py-20">
      <JsonLd
        data={graph(
          organizationNode(),
          websiteNode(),
          webPageNode(C.path, C.title, C.description),
          breadcrumbNode([
            { name: "Home", path: "/" },
            { name: "Bug bounty", path: C.path },
          ]),
        )}
      />

      <div className="max-w-[820px]">
        <div className="mb-3.5 text-[13px] font-bold uppercase tracking-[2.5px] text-accent">
          Bug bounty
        </div>
        <h1 className="font-display text-[clamp(38px,5vw,58px)] font-extrabold leading-[1.05] tracking-[-1.5px]">
          {C.h1}
        </h1>
        <p className="mt-6 max-w-[680px] text-[18.5px] text-text-dim">
          Labs teach you the technique. A bounty program is where it meets a system somebody
          depends on, with scope, safe harbour and a payout schedule written down before you send
          the first request.
        </p>
        <div className="mt-9 flex flex-wrap gap-3">
          <Link href={link("bugbounty", "/bounty")}>
            <Button size="lg">Browse programs</Button>
          </Link>
          <Link href={CLUSTERS.labs.path}>
            <Button size="lg" variant="ghost">
              Practise first
            </Button>
          </Link>
          <Link href="/contact">
            <Button size="lg" variant="ghost">
              Run a program
            </Button>
          </Link>
        </div>
      </div>

      <section className="mt-24">
        <h2 className="font-display text-[clamp(26px,3.2vw,38px)] font-bold tracking-[-0.8px]">
          How the platform works
        </h2>
        <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-2">
          {PILLARS.map((f) => {
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

      <section className="mt-24">
        <h2 className="font-display text-[clamp(26px,3.2vw,38px)] font-bold tracking-[-0.8px]">
          From target to payout
        </h2>
        <ol className="mt-10 border-t border-line">
          {WORKFLOW.map((s, i) => (
            <li
              key={s.step}
              className="grid gap-2 border-b border-line py-6 sm:grid-cols-[210px_1fr] sm:gap-8"
            >
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-[12px] text-text-faint">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="font-display text-[17px] font-semibold">{s.step}</h3>
              </div>
              <p className="text-[15px] leading-[1.7] text-text-dim">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-24">
        <div className="mb-3.5 flex items-center gap-2 text-[13px] font-bold uppercase tracking-[2.5px] text-accent">
          <Building2 className="h-4 w-4" /> For companies
        </div>
        <h2 className="font-display text-[clamp(26px,3.2vw,38px)] font-bold tracking-[-0.8px]">
          Run your own bug bounty program
        </h2>
        <p className="mt-4 max-w-[680px] text-[16.5px] leading-[1.7] text-text-dim">
          The other side of the platform. Put your systems in front of vetted researchers, get
          structured reports triaged before they reach your engineers, and pay only for real,
          in-scope findings.
        </p>
        <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-2">
          {FOR_COMPANIES.map((f) => {
            const Icon = f.icon;
            return (
              <Card tilt key={f.title} className="p-7">
                <div className="mb-5 grid h-[52px] w-[52px] place-items-center border border-line bg-brand-gradient-soft">
                  <Icon className="h-[26px] w-[26px] text-accent" strokeWidth={1.9} />
                </div>
                <h3 className="mb-2.5 font-display text-[20px] font-semibold">{f.title}</h3>
                <p className="text-[14.8px] leading-[1.7] text-text-dim">{f.body}</p>
              </Card>
            );
          })}
        </div>
        <Link href="/contact" className="mt-9 inline-block">
          <Button size="lg">Talk to us about a program</Button>
        </Link>
      </section>

      <Faq items={FAQ} path={C.path} title="Bug bounty questions, answered" />

      <div className="bracket-frame mt-24 px-6 py-16 text-center md:px-16">
        <h2 className="font-display text-[clamp(28px,4.4vw,56px)] font-extrabold uppercase leading-[0.95] tracking-mega">
          Hunt something <span className="text-gradient">real</span>.
        </h2>
        <p className="mx-auto mt-6 max-w-[440px] text-[13px] leading-[1.8] text-text-dim">
          Create an account, build the skill on the labs, and take it to a live program.
        </p>
        <Link href="/register" className="mt-9 inline-block">
          <Button size="lg">Get started — free</Button>
        </Link>
      </div>
    </div>
  );
}
