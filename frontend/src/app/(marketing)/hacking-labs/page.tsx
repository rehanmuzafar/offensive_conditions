/**
 * The labs cluster: the public catalogue of vulnerable machines.
 *
 * The signed-in catalogue at `app.offensiveconditions.org/machines` is behind
 * `AuthGuard` and always will be — spawning a box is a privileged action. But
 * the *existence* of a box, what it runs and roughly how hard it is, is
 * marketing copy, not a secret, and it is the only page on this site with
 * enough specific nouns on it to answer a long-tail query like "windows active
 * directory practice lab". Nothing here leaks a flag, a hint, or an address.
 *
 * `?q=` is honoured because `websiteNode()` advertises this path as the site's
 * `SearchAction` target. Google verifies that target actually searches; a
 * parameter the page ignores would get the whole node dropped.
 */

import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Faq, type QA } from "@/components/seo/faq";
import { JsonLd } from "@/components/seo/json-ld";
import { CLUSTERS, absolute } from "@/lib/seo/config";
import {
  breadcrumbNode,
  graph,
  itemListNode,
  machineNode,
  organizationNode,
  webPageNode,
  websiteNode,
} from "@/lib/seo/jsonld";
import { indexableMachines, type PublicMachine } from "@/lib/seo/public-data";

const C = CLUSTERS.labs;

type Props = { searchParams: Promise<{ q?: string; os?: string; difficulty?: string }> };

/**
 * Metadata has to be generated rather than static, because the facets below
 * are real URLs and every one of them would otherwise be a near-duplicate of
 * this page competing with it.
 *
 * Two things stop that. The canonical always points at the unfiltered path, so
 * whatever Google crawls it consolidates onto one URL; and a filtered view is
 * additionally marked `noindex, follow`, because a facet combination is a
 * convenience for a visitor, not a page anyone searches for. `follow` matters —
 * the machine links on a filtered view should still be discovered through it.
 */
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q, os, difficulty } = await searchParams;
  const filtered = Boolean(q || os || difficulty);

  const title = os
    ? `${titleCase(os)} Hacking Labs — Vulnerable Machines`
    : difficulty
      ? `${titleCase(difficulty)} Hacking Labs — Vulnerable Machines`
      : C.title;

  return {
    title,
    description: C.description,
    alternates: { canonical: absolute(C.path) },
    robots: filtered ? { index: false, follow: true } : undefined,
    openGraph: {
      title,
      description: C.description,
      url: absolute(C.path),
      type: "website",
    },
  };
}

function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

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

const DIFFICULTY_ORDER = ["very_easy", "easy", "medium", "hard", "insane"];

const FAQ: QA[] = [
  {
    q: "What is a vulnerable machine?",
    a: "A complete operating system — Linux, Windows, or a small Active Directory forest — deliberately built with a chain of real misconfigurations and vulnerabilities in it. You get a network address and nothing else. The work is the same work a penetration test is: enumerate what is listening, find the way in, get a shell as an unprivileged user, then escalate to root or Domain Admin.",
  },
  {
    q: "How is this different from watching a course?",
    a: "There is no walkthrough running alongside you and no next button. A machine is solved when you produce the two flags that prove you actually got user and then root on it, which is a claim that cannot be made by following along. Writeups exist, and unlock automatically once you have solved a box yourself.",
  },
  {
    q: "Is it safe to attack these machines?",
    a: "Yes, and it is the only place you should. Every machine runs sandboxed under gVisor and network-segmented from every other user's instance, so an exploit cannot reach another competitor, the platform, or anything outside the lab. Attacking systems you do not have written permission to test is a criminal offence in most countries — the point of a lab is that the permission is already given.",
  },
  {
    q: "Which machine should I start with?",
    a: "A very easy or easy Linux box. They are built to be solved with nmap, a web exploit you can find by reading the application, and a privilege escalation that a standard enumeration script will point at. Windows and Active Directory boxes assume you already know what a shell looks like.",
  },
  {
    q: "Can I just copy someone else's flag?",
    a: "No. Every machine's flags are unique to you: they are HMAC-signed against your own user and your running instance, so a flag someone else was given simply does not verify against your solve. There is no shared answer key to pass around \u2014 the only way to get your flag is to actually root your box.",
  },
  {
    q: "Do I need my own attack machine?",
    a: "You need something to attack from — Kali or Parrot in a virtual machine is the usual answer, and both ship with everything these boxes require. You connect to the lab network over WireGuard; the configuration file is generated for you once you have an account.",
  },
];

export default async function HackingLabsPage({ searchParams }: Props) {
  const { q, os, difficulty } = await searchParams;
  const all = await indexableMachines();
  const machines = filterMachines(all, { q, os, difficulty });

  const byOs = countBy(all, (m) => m.os);
  const byDifficulty = countBy(all, (m) => m.difficulty);

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-20">
      <JsonLd
        data={graph(
          organizationNode(),
          websiteNode(),
          webPageNode(C.path, C.title, C.description),
          breadcrumbNode([
            { name: "Home", path: "/" },
            { name: "Hacking labs", path: C.path },
          ]),
          itemListNode(
            C.path,
            "Vulnerable machines on OFFCON",
            all.map((m) => ({ name: m.name, path: `${C.path}/${m.slug}` })),
          ),
          ...all.map(machineNode),
        )}
      />

      <div className="max-w-[820px]">
        <div className="mb-3.5 text-[13px] font-bold uppercase tracking-[2.5px] text-accent">
          Hacking labs
        </div>
        <h1 className="font-display text-[clamp(38px,5vw,58px)] font-extrabold leading-[1.05] tracking-[-1.5px]">
          {C.h1}
        </h1>
        <p className="mt-6 max-w-[680px] text-[18.5px] text-text-dim">
          Linux, Windows and Active Directory boxes with a real vulnerability chain in each one.
          You get an address and nothing else. Every instance is yours alone, sandboxed under
          gVisor, and torn down cleanly when you are finished.
        </p>
        <div className="mt-9 flex flex-wrap gap-3">
          <Link href="/register">
            <Button size="lg">Get lab access — free</Button>
          </Link>
          <Link href={CLUSTERS.training.path}>
            <Button size="lg" variant="ghost">
              Follow a guided track
            </Button>
          </Link>
        </div>
      </div>

      {/* facets — plain links, so a crawler can walk them and each combination
          is a real URL rather than a client-side state nothing can reach */}
      {all.length > 0 && (
        <div className="mt-14 flex flex-wrap items-center gap-2 border-y border-line py-4 text-[13px]">
          <Facet href={C.path} active={!os && !difficulty && !q} label={`All ${all.length}`} />
          {Object.entries(byOs).map(([value, n]) => (
            <Facet
              key={value}
              href={`${C.path}?os=${encodeURIComponent(value)}`}
              active={os === value}
              label={`${value} ${n}`}
            />
          ))}
          {Object.entries(byDifficulty)
            .sort((a, b) => DIFFICULTY_ORDER.indexOf(a[0]) - DIFFICULTY_ORDER.indexOf(b[0]))
            .map(([value, n]) => (
              <Facet
                key={value}
                href={`${C.path}?difficulty=${encodeURIComponent(value)}`}
                active={difficulty === value}
                label={`${value.replace(/_/g, " ")} ${n}`}
              />
            ))}
        </div>
      )}

      <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
        {machines.map((m) => (
          <Link key={m.slug} href={`${C.path}/${m.slug}`} className="block">
            <Card tilt className="h-full p-6">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                {m.os && <Badge tone="info">{m.os}</Badge>}
                {m.difficulty && (
                  <Badge tone={difficultyTone(m.difficulty)}>{m.difficulty.replace(/_/g, " ")}</Badge>
                )}
              </div>
              <h2 className="font-display text-[19px] font-semibold">{m.name}</h2>
              {m.description && (
                <p className="mt-2 line-clamp-3 text-[14px] leading-[1.65] text-text-dim">
                  {m.description}
                </p>
              )}
              <div className="mt-5 flex flex-wrap gap-x-5 gap-y-1.5 text-[12.5px] text-text-faint">
                {typeof m.total_root_owns === "number" && <span>{m.total_root_owns} root owns</span>}
                {typeof m.rating_avg === "number" && m.rating_avg > 0 && (
                  <span>{m.rating_avg.toFixed(1)} / 5</span>
                )}
              </div>
            </Card>
          </Link>
        ))}
      </div>

      {machines.length === 0 && (
        <Card className="mt-10 p-10 text-center" interactive={false}>
          <h2 className="font-display text-[20px] font-semibold">Nothing matches that filter</h2>
          <p className="mx-auto mt-3 max-w-[420px] text-[15px] text-text-dim">
            Try a different operating system or difficulty.
          </p>
          <Link href={C.path} className="mt-7 inline-block">
            <Button variant="ghost">Show every machine</Button>
          </Link>
        </Card>
      )}

      <Faq items={FAQ} path={C.path} title="Lab questions, answered" />

      <div className="bracket-frame mt-24 px-6 py-16 text-center md:px-16">
        <h2 className="font-display text-[clamp(28px,4.4vw,56px)] font-extrabold uppercase leading-[0.95] tracking-mega">
          Root your <span className="text-gradient">first box</span>.
        </h2>
        <p className="mx-auto mt-6 max-w-[440px] text-[13px] leading-[1.8] text-text-dim">
          A free account gets you VPN access and the starting machines. No card.
        </p>
        <Link href="/register" className="mt-9 inline-block">
          <Button size="lg">Start hacking</Button>
        </Link>
      </div>
    </div>
  );
}

function Facet({ href, label, active }: { href: string; label: string; active?: boolean }) {
  return (
    <Link
      href={href}
      className={
        active
          ? "border border-accent/50 px-2.5 py-1 capitalize text-accent"
          : "border border-line px-2.5 py-1 capitalize text-text-dim transition-colors hover:border-line-strong hover:text-text"
      }
    >
      {label}
    </Link>
  );
}

function difficultyTone(d: string) {
  if (d === "very_easy" || d === "easy") return "success" as const;
  if (d === "medium") return "warning" as const;
  return "danger" as const;
}

function filterMachines(
  machines: PublicMachine[],
  f: { q?: string; os?: string; difficulty?: string },
): PublicMachine[] {
  const needle = f.q?.trim().toLowerCase();
  return machines.filter((m) => {
    if (f.os && m.os !== f.os) return false;
    if (f.difficulty && m.difficulty !== f.difficulty) return false;
    if (needle) {
      const hay = `${m.name} ${m.description ?? ""} ${(m.tags ?? []).join(" ")}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

function countBy<T>(rows: T[], key: (row: T) => string | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const k = key(row);
    if (!k) continue;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
