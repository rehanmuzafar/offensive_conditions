/**
 * The training cluster.
 *
 * "Offensive security training" and "ethical hacking course" are the queries
 * with commercial intent behind them — someone typing those is deciding where
 * to spend money or a year, not browsing. That makes this the page that has to
 * argue, not just list, which is why the method section below is longer than a
 * catalogue page would justify.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Route, Server, Flag, FileText } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Faq, type QA } from "@/components/seo/faq";
import { JsonLd } from "@/components/seo/json-ld";
import { CLUSTERS, absolute } from "@/lib/seo/config";
import {
  breadcrumbNode,
  courseNode,
  graph,
  itemListNode,
  organizationNode,
  webPageNode,
  websiteNode,
} from "@/lib/seo/jsonld";
import { indexablePaths } from "@/lib/seo/public-data";

const C = CLUSTERS.training;

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

/**
 * Rendered per request, not at build.
 *
 * The builder container cannot reach `edge:8080` - it runs on the default
 * bridge network, not the compose one - so anything prerendered during
 * `docker compose build` is prerendered against an unreachable gateway and
 * comes out empty. ISR would then hold that empty version for the whole
 * revalidate window, because a freshly built page is not stale.
 *
 * `fetchCache` keeps the per-fetch `revalidate` in `lib/seo/public-data.ts`
 * in effect, so this is one upstream call an hour shared across these routes,
 * not one per request.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "default-cache";

const METHOD = [
  {
    icon: Route,
    title: "Tracks, not playlists",
    body: "A track is an ordered set of modules with a gate between them. You do not advance by marking a video watched — you advance by producing the flag that proves you did the thing the module taught.",
  },
  {
    icon: Server,
    title: "Every lesson ends on a real box",
    body: "Theory is the short half. Each module hands you a machine with the vulnerability class you just read about actually present on it, and you exploit it yourself, with no walkthrough running alongside.",
  },
  {
    icon: Flag,
    title: "Competition as assessment",
    body: "CTF events are the exam nobody can cheat. A scoreboard is a ranking against everyone who sat the same problems under the same clock, which is a far harder number to fake than a completion percentage.",
  },
  {
    icon: FileText,
    title: "Writing as proof",
    body: "Publishing a writeup is how a solve becomes something you can show an employer. They unlock once you have solved the box yourself, so a published writeup is evidence rather than a transcript.",
  },
];

const CURRICULUM = [
  { stage: "Foundations", body: "Networking, Linux, the shell, and how a service exposes itself. Your first nmap scan and your first understanding of what it returned." },
  { stage: "Web exploitation", body: "Injection, authentication and session flaws, SSRF, file upload, deserialisation — found by reading an application rather than by running a scanner at it." },
  { stage: "System exploitation", body: "Privilege escalation on Linux and Windows: misconfigured services, weak permissions, credential reuse, kernel and userland escalation paths." },
  { stage: "Active Directory", body: "Enumeration, Kerberos attacks, delegation abuse, lateral movement, and the path from one domain user to Domain Admin." },
  { stage: "Binary exploitation", body: "Memory corruption from first principles: stack overflows, ROP, heap exploitation, and the mitigations you have to defeat along the way." },
  { stage: "Operating", body: "Tradecraft: pivoting, tunnelling, evasion and reporting — turning an exploit into an engagement someone will pay for." },
];

const FAQ: QA[] = [
  {
    q: "Is OFFCON suitable for a complete beginner?",
    a: "Yes, provided you are comfortable with a computer and willing to read. The foundations track assumes no security knowledge at all and starts at what a port is. What it does assume is that you will spend time stuck — that is the actual skill being trained, and no course can remove it.",
  },
  {
    q: "How long does it take to become employable?",
    a: "For someone studying seriously alongside other commitments, twelve to eighteen months to junior penetration tester is a realistic and commonly observed range. Anyone promising ninety days is selling something. What shortens it is volume of hands-on work and visible proof of it — solved machines, published writeups, CTF placements.",
  },
  {
    q: "Do I get a certificate?",
    a: "Tracks that are marked as certificate-bearing issue one on completion, and CTF events can issue participation and placement certificates. Treat them as supporting evidence rather than as the thing itself — in this field a portfolio of solved machines and written work carries further than a certificate does.",
  },
  {
    q: "How does this compare to a university degree?",
    a: "They answer different questions. A degree gives you theory, mathematics and a credential that passes an HR filter. This gives you the practical ability the job is actually assessed on at interview. People who have both do best; if you have to pick one to start, the hands-on skill is the one you can demonstrate in a technical interview.",
  },
  {
    q: "Is everything free?",
    a: "A free account covers registration, the starting machines, the community and entry to free CTF events. Paid tiers add the full machine catalogue, the guided tracks and priority lab capacity. Pricing is listed publicly, in local currency where we support it.",
  },
];

export default async function TrainingPage() {
  const paths = await indexablePaths();

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-20">
      <JsonLd
        data={graph(
          organizationNode(),
          websiteNode(),
          webPageNode(C.path, C.title, C.description),
          breadcrumbNode([
            { name: "Home", path: "/" },
            { name: "Offensive security training", path: C.path },
          ]),
          itemListNode(
            C.path,
            "Guided tracks on OFFCON",
            paths.map((p) => ({ name: p.name, path: `${C.path}/${p.slug}` })),
          ),
          ...paths.map(courseNode),
        )}
      />

      <div className="max-w-[820px]">
        <div className="mb-3.5 text-[13px] font-bold uppercase tracking-[2.5px] text-accent">
          Training
        </div>
        <h1 className="font-display text-[clamp(38px,5vw,58px)] font-extrabold leading-[1.05] tracking-[-1.5px]">
          {C.h1}
        </h1>
        <p className="mt-6 max-w-[680px] text-[18.5px] text-text-dim">
          Structured paths from your first scan to advanced exploitation. Every module is gated on
          a real, breakable system, so progress means you did the thing — not that you watched
          someone else do it.
        </p>
        <div className="mt-9 flex flex-wrap gap-3">
          <Link href="/register">
            <Button size="lg">Start free</Button>
          </Link>
          <Link href="/pricing">
            <Button size="lg" variant="ghost">
              See pricing
            </Button>
          </Link>
        </div>
      </div>

      {paths.length > 0 && (
        <section className="mt-20">
          <h2 className="font-display text-[clamp(22px,2.6vw,30px)] font-bold tracking-[-0.6px]">
            Guided tracks
          </h2>
          <div className="mt-7 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {paths.map((p) => (
              <Link key={p.slug} href={`${C.path}/${p.slug}`} className="block">
                <Card tilt className="h-full p-6">
                  {p.difficulty && <Badge tone="brand">{p.difficulty}</Badge>}
                  <h3 className="mt-3 font-display text-[19px] font-semibold">{p.name}</h3>
                  {p.description && (
                    <p className="mt-2 line-clamp-3 text-[14px] leading-[1.65] text-text-dim">
                      {p.description}
                    </p>
                  )}
                  <div className="mt-5 flex flex-wrap gap-x-5 gap-y-1.5 text-[12.5px] text-text-faint">
                    {p.module_count ? <span>{p.module_count} modules</span> : null}
                    {p.machine_count ? <span>{p.machine_count} machines</span> : null}
                    {p.estimated_hours ? <span>~{p.estimated_hours}h</span> : null}
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="mt-24">
        <h2 className="font-display text-[clamp(26px,3.2vw,38px)] font-bold tracking-[-0.8px]">
          How the training works
        </h2>
        <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-2">
          {METHOD.map((f) => {
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
          What you will cover
        </h2>
        <ol className="mt-10 border-t border-line">
          {CURRICULUM.map((s, i) => (
            <li key={s.stage} className="grid gap-2 border-b border-line py-6 sm:grid-cols-[180px_1fr] sm:gap-8">
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-[12px] text-text-faint">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="font-display text-[17px] font-semibold">{s.stage}</h3>
              </div>
              <p className="text-[15px] leading-[1.7] text-text-dim">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <Faq items={FAQ} path={C.path} title="Training questions, answered" />

      <div className="bracket-frame mt-24 px-6 py-16 text-center md:px-16">
        <h2 className="font-display text-[clamp(28px,4.4vw,56px)] font-extrabold uppercase leading-[0.95] tracking-mega">
          Start <span className="text-gradient">today</span>.
        </h2>
        <p className="mx-auto mt-6 max-w-[440px] text-[13px] leading-[1.8] text-text-dim">
          Free account, real machines, no card required.
        </p>
        <Link href="/register" className="mt-9 inline-block">
          <Button size="lg">Create an account</Button>
        </Link>
      </div>
    </div>
  );
}
