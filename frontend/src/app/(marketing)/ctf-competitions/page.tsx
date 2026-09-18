/**
 * The CTF cluster's landing page.
 *
 * Lives on the apex rather than on `ctf.offensiveconditions.org` deliberately.
 * The CTF host is behind `AuthGuard`, so everything on it is invisible to a
 * crawler — and even if it were not, a subdomain accrues authority separately
 * from the apex, which for a domain this new means splitting a small amount of
 * trust into two smaller amounts. The public, indexable half of the CTF product
 * belongs on the domain that has to rank.
 *
 * The path is `/ctf-competitions` and not `/ctf` because `/ctf` is claimed by
 * the middleware's OWNER map and 307s to the CTF host. `ctf-competitions` also
 * happens to match the phrase people actually search, which `/ctf` does not.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Flag, Users, Timer, Trophy, Swords, Crown, Zap, Fingerprint, Shuffle, KeyRound, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Faq, type QA } from "@/components/seo/faq";
import { JsonLd } from "@/components/seo/json-ld";
import { CLUSTERS, absolute } from "@/lib/seo/config";
import {
  breadcrumbNode,
  eventNode,
  graph,
  itemListNode,
  organizationNode,
  webPageNode,
  websiteNode,
} from "@/lib/seo/jsonld";
import { isIndexableEvent } from "@/lib/seo/indexable";
import { publicEvents, type PublicEvent } from "@/lib/seo/public-data";
import { formatDate } from "@/lib/seo/format";
import { link } from "@/lib/surfaces";

const C = CLUSTERS.ctf;

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

const FORMATS = [
  {
    icon: Flag,
    title: "Jeopardy",
    body: "A board of challenges across web, pwn, reverse engineering, crypto, forensics and OSINT. Solve what you can, in any order. Points fall as more teams solve a challenge, so the board rewards the people who got there first.",
  },
  {
    icon: Users,
    title: "Attack–defense",
    body: "Every team gets the same vulnerable services and has to patch their own while exploiting everyone else's. Scoring runs in ticks: you hold points for staying up and take them for every flag you steal.",
  },
  {
    icon: Timer,
    title: "Waves",
    body: "Challenges unlock in timed rounds rather than all at once, so a team that stalls on one category is not locked out of the rest of the event.",
  },
  {
    icon: Trophy,
    title: "Seasons",
    body: "Event results roll into a seasonal ladder with a quarter of your score carried into the next season, so a strong run keeps counting after the event ends.",
  },
  {
    icon: Swords,
    title: "Head-to-Head",
    body: "Two players or two teams, the same challenge, one clock. Whoever produces the flag first takes the round. Runs as a bracket, so a match is over in minutes and a tournament resolves to a single winner instead of a leaderboard.",
  },
  {
    icon: Zap,
    title: "Showdowns",
    body: "Live, spectated elimination rounds built for an audience. Short timed matches, a shoutcast-style scoreboard, and first-blood decides it — the format we run on stage at the conference and at campus events.",
  },
  {
    icon: Crown,
    title: "King of the Hill",
    body: "Everyone attacks one shared machine. Break in, plant your flag, and hold root — you score for every tick you stay king while the rest of the field tries to evict you and take the crown. Persistence and patching matter as much as the initial exploit.",
  },
];

const FAQ: QA[] = [
  {
    q: "What is a CTF competition?",
    a: "Capture The Flag is a competitive format for offensive security. Organisers hide a string — the flag — inside a deliberately vulnerable system, and you recover it by actually breaking in: exploiting a web application, reversing a binary, breaking a weak cipher, or pivoting through a network. You submit the flag, you score. It is the closest thing the field has to a sport, and it is how most professionals first learned the work.",
  },
  {
    q: "Do I need experience to enter my first CTF?",
    a: "No. Jeopardy events are built with a difficulty spread on purpose — the easiest challenges in a board are usually solvable by someone in their first month, and they exist precisely so newcomers have somewhere to start. If you would rather build a base first, the guided tracks and the easy machines cover the same ground without a clock running.",
  },
  {
    q: "Can I compete solo, or do I need a team?",
    a: "Both work. Each event decides whether it allows solo entries, team entries, or both, and the maximum team size is set per event. Solo play is listed on the event page before you register, so you know which it is before committing.",
  },
  {
    q: "Are CTF competitions on OFFCON free?",
    a: "Some are free and some charge an entry fee, and the fee is shown on the event page before you register. Paid events are typically the ones carrying a prize pool. Entry is charged once per team rather than per player, so adding someone to your roster afterwards does not cost extra.",
  },
  {
    q: "What tools do I need?",
    a: "A Linux machine — Kali or Parrot if you want everything preinstalled — and a WireGuard client to reach the lab network. Nothing beyond that is required. Challenges never depend on paid tooling.",
  },
  {
    q: "How does scoring work?",
    a: "Most events use dynamic scoring: a challenge starts at a maximum value and decays towards a floor as more teams solve it, so an early solve on a hard challenge is worth considerably more than a late solve on an easy one. First blood on a challenge carries a bonus on top. Scoreboards can be frozen near the end so the final standings stay a surprise.",
  },
  {
    q: "Can teams cheat by sharing flags?",
    a: "No — flag sharing is designed out. Every team spawns its own instance of a challenge, and its flag is generated randomly for that instance from the OS cryptographic random source; only a SHA-256 hash of it is ever stored. A flag is valid for exactly one team's instance, so a flag passed to another team is rejected. Machine challenges bind the flag even tighter, HMAC-signing it against the individual user and instance. Kill the instance and the flag dies with it — there is no shared secret to trade.",
  },
];

const ANTICHEAT = [
  {
    icon: Shuffle,
    title: "A random flag per instance",
    body: "Every team spawns its own private copy of a challenge, and its flag is generated the moment that instance starts — straight from the operating system's cryptographic random source. It is never reused and never guessable from the challenge.",
  },
  {
    icon: KeyRound,
    title: "The flag never leaves your instance",
    body: "The platform stores only a SHA-256 hash of the flag, never the flag itself. The only place the real value exists is inside your running instance — there is nothing on the server to leak, and nothing to look up.",
  },
  {
    icon: Fingerprint,
    title: "Bound to the team that earned it",
    body: "Submit a flag another team was given and it is rejected — it was valid for their instance, not yours. Machine challenges go further still: their flags are HMAC-signed against your own user and instance, so a copied flag simply does not verify.",
  },
  {
    icon: ShieldCheck,
    title: "Kill the instance, kill the flag",
    body: "Tear an instance down or let it expire and its flag dies with it. The next instance mints a fresh one. There is no single \u201creal\u201d flag to pass around — which is exactly why passing one around is pointless.",
  },
];

export default async function CtfCompetitionsPage() {
  // The listing shows every genuinely public event, so a visitor sees what is
  // actually live right now. The SEO gate is applied only to what gets *indexed*
  // (the sitemap, the per-event noindex, and the structured data below) - a
  // test/seed event is still shown to a human here but kept out of Google.
  const events = await publicEvents();
  const live = events.filter((e) => e.status === "live");
  const upcoming = events.filter((e) => e.status === "upcoming" || e.status === "registration");
  const past = events.filter((e) => e.status === "ended");
  const indexable = events.filter(isIndexableEvent);

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-20">
      <JsonLd
        data={graph(
          organizationNode(),
          websiteNode(),
          webPageNode(C.path, C.title, C.description),
          breadcrumbNode([
            { name: "Home", path: "/" },
            { name: "CTF competitions", path: C.path },
          ]),
          itemListNode(
            C.path,
            "CTF competitions on OFFCON",
            indexable.map((e) => ({ name: e.name, path: `${C.path}/${e.slug}` })),
          ),
          ...indexable.map(eventNode),
        )}
      />

      <div className="max-w-[820px]">
        <div className="mb-3.5 text-[13px] font-bold uppercase tracking-[2.5px] text-accent">
          Capture The Flag
        </div>
        <h1 className="font-display text-[clamp(38px,5vw,58px)] font-extrabold leading-[1.05] tracking-[-1.5px]">
          {C.h1}
        </h1>
        <p className="mt-6 max-w-[680px] text-[18.5px] text-text-dim">
          Jeopardy boards and attack–defense arenas with live scoreboards, first-blood alerts and
          seasonal standings. Enter solo or bring a team, on infrastructure that spins a fresh,
          isolated copy of every challenge for each competitor.
        </p>
        <div className="mt-9 flex flex-wrap gap-3">
          <Link href="/register">
            <Button size="lg">Create a free account</Button>
          </Link>
          <Link href={link("ctf", "/ctf")}>
            <Button size="lg" variant="ghost">
              Open the arena
            </Button>
          </Link>
        </div>
      </div>

      {live.length > 0 && <EventBand heading="Running now" events={live} tone="live" />}
      {upcoming.length > 0 && <EventBand heading="Open for registration" events={upcoming} />}
      {past.length > 0 && <EventBand heading="Past events" events={past.slice(0, 9)} />}

      {events.length === 0 && (
        <Card className="mt-16 p-10 text-center" interactive={false}>
          <h2 className="font-display text-[22px] font-semibold">No public events right now</h2>
          <p className="mx-auto mt-3 max-w-[460px] text-[15px] text-text-dim">
            The next season is being put together. Create an account and you will be told when
            registration opens.
          </p>
          <Link href="/register" className="mt-7 inline-block">
            <Button>Notify me</Button>
          </Link>
        </Card>
      )}

      {/* formats — the substance a search result for "ctf" is looking for */}
      <section className="mt-24">
        <h2 className="font-display text-[clamp(26px,3.2vw,38px)] font-bold tracking-[-0.8px]">
          The formats we run
        </h2>
        <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-2">
          {FORMATS.map((f) => {
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

      {/* Anti-cheat / flag-sharing — a real, verifiable differentiator. */}
      <section className="mt-24">
        <div className="mb-3.5 flex items-center gap-2 text-[13px] font-bold uppercase tracking-[2.5px] text-accent">
          <ShieldCheck className="h-4 w-4" /> Cheat-resistant by design
        </div>
        <h2 className="font-display text-[clamp(26px,3.2vw,38px)] font-bold tracking-[-0.8px]">
          Sharing a flag gets you nowhere
        </h2>
        <p className="mt-4 max-w-[760px] text-[16.5px] leading-[1.7] text-text-dim">
          Flag leaking and trading is a problem even the biggest CTFs never fully
          solve — one team roots a box, the flag ends up in a group chat, and the
          scoreboard stops meaning anything. On OFFCON it means nothing, because a
          flag is only ever valid for the instance and the team it was minted for.
        </p>
        <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-2">
          {ANTICHEAT.map((f) => {
            const Icon = f.icon;
            return (
              <Card key={f.title} tilt className="p-7">
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

      <Faq items={FAQ} path={C.path} title="CTF questions, answered" />

      <div className="bracket-frame mt-24 px-6 py-16 text-center md:px-16">
        <h2 className="font-display text-[clamp(28px,4.4vw,56px)] font-extrabold uppercase leading-[0.95] tracking-mega">
          Your first <span className="text-gradient">flag</span> is waiting.
        </h2>
        <p className="mx-auto mt-6 max-w-[440px] text-[13px] leading-[1.8] text-text-dim">
          Free account, no card. Start on the practice machines and enter the next event when you
          are ready.
        </p>
        <Link href="/register" className="mt-9 inline-block">
          <Button size="lg">Start competing</Button>
        </Link>
      </div>
    </div>
  );
}

function EventBand({
  heading,
  events,
  tone,
}: {
  heading: string;
  events: PublicEvent[];
  tone?: "live";
}) {
  return (
    <section className="mt-20">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-display text-[clamp(22px,2.6vw,30px)] font-bold tracking-[-0.6px]">
          {heading}
        </h2>
        <span className="text-[13px] text-text-faint">{events.length}</span>
      </div>
      <div className="mt-7 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
        {events.map((e) => (
          <Link key={e.slug} href={`${CLUSTERS.ctf.path}/${e.slug}`} className="block">
            <Card tilt className="h-full p-6">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                {tone === "live" ? (
                  <Badge tone="success" dot>
                    Live
                  </Badge>
                ) : (
                  <Badge>{e.status ?? "scheduled"}</Badge>
                )}
                {e.format && <Badge tone="brand">{e.format}</Badge>}
              </div>
              <h3 className="font-display text-[18px] font-semibold leading-snug">{e.name}</h3>
              {e.description && (
                <p className="mt-2 line-clamp-3 text-[14px] leading-[1.65] text-text-dim">
                  {e.description}
                </p>
              )}
              <dl className="mt-5 flex flex-wrap gap-x-6 gap-y-1.5 text-[12.5px] text-text-faint">
                {e.starts_at && (
                  <div>
                    <dt className="sr-only">Starts</dt>
                    <dd>
                      <time dateTime={e.starts_at}>{formatDate(e.starts_at)}</time>
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="sr-only">Challenges</dt>
                  <dd>{e.challenge_count ?? 0} challenges</dd>
                </div>
                {e.team_play && (
                  <div>
                    <dt className="sr-only">Team size</dt>
                    <dd>Teams up to {e.max_team_size ?? 4}</dd>
                  </div>
                )}
              </dl>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}
