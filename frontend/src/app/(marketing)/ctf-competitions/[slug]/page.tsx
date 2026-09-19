/**
 * A public page for one CTF event.
 *
 * This is the read-only half of an event: what it is, when it runs, how it
 * scores, what it costs. Playing it still happens behind `AuthGuard` on the CTF
 * host — nothing here exposes a challenge, a flag or a scoreboard position that
 * the arena would not already show a logged-out visitor.
 *
 * The page renders for every public event, but only advertises itself for the
 * ones that clear `isIndexableEvent`. That split is deliberate: a participant
 * handed a link to a thin or draft event should still get a real page, while
 * the index should only ever see events with enough on them to be worth
 * arriving at cold. `noindex, follow` is the right pair — do not rank this, but
 * do follow the links off it back into the site.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { JsonLd } from "@/components/seo/json-ld";
import { CLUSTERS, absolute } from "@/lib/seo/config";
import { formatDate, formatRange } from "@/lib/seo/format";
import { isIndexableEvent } from "@/lib/seo/indexable";
import {
  breadcrumbNode,
  eventNode,
  graph,
  organizationNode,
  webPageNode,
} from "@/lib/seo/jsonld";
import { eventBySlug, indexableEvents, type PublicEvent } from "@/lib/seo/public-data";
import { link } from "@/lib/surfaces";

const C = CLUSTERS.ctf;

export const revalidate = 3600;

/**
 * Only the indexable events are prebuilt. The rest still render — the segment
 * falls through to on-demand rendering — but they are not worth a build slot,
 * and prebuilding a list dominated by seed data would put it in the build
 * output where it is easy to mistake for real content.
 */
export async function generateStaticParams() {
  const events = await indexableEvents();
  return events.map((e) => ({ slug: e.slug }));
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const event = await eventBySlug(slug);
  if (!event) return { title: "Event not found", robots: { index: false, follow: false } };

  const path = `${C.path}/${event.slug}`;
  const description = summarise(event);
  const indexable = isIndexableEvent(event);

  return {
    title: `${event.name} — CTF competition`,
    description,
    alternates: { canonical: absolute(path) },
    robots: indexable ? undefined : { index: false, follow: true },
    openGraph: {
      title: `${event.name} — CTF competition`,
      description,
      url: absolute(path),
      type: "website",
    },
  };
}

export default async function EventPage({ params }: Props) {
  const { slug } = await params;
  const event = await eventBySlug(slug);

  // A private or invitation-only event has no public page at all. 404 rather
  // than 403: the existence of an unlisted event is itself information.
  if (!event || event.visibility !== "public" || event.invitation_only) notFound();

  const path = `${C.path}/${event.slug}`;
  const indexable = isIndexableEvent(event);
  const dates = formatRange(event.starts_at, event.ends_at);
  const fee = (event.entry_fee_cents ?? 0) / 100;

  return (
    <div className="mx-auto max-w-[900px] px-6 py-20">
      {/* Only describe the event to a crawler when we are also asking it to be
          indexed. Structured data on a noindex page is not harmful, but it is
          a contradiction that shows up in Search Console as an unresolvable
          item, and a clean report is worth more than a node nobody reads. */}
      {indexable && (
        <JsonLd
          data={graph(
            organizationNode(),
            webPageNode(path, event.name, summarise(event)),
            breadcrumbNode([
              { name: "Home", path: "/" },
              { name: "CTF competitions", path: C.path },
              { name: event.name, path },
            ]),
            eventNode(event),
          )}
        />
      )}

      <nav aria-label="Breadcrumb" className="mb-8 text-[13px] text-text-faint">
        <Link href="/" className="hover:text-accent">
          Home
        </Link>
        <span className="mx-2">/</span>
        <Link href={C.path} className="hover:text-accent">
          CTF competitions
        </Link>
        <span className="mx-2">/</span>
        <span className="text-text-dim">{event.name}</span>
      </nav>

      <div className="flex flex-wrap items-center gap-2">
        {event.status === "live" ? (
          <Badge tone="success" dot>
            Live now
          </Badge>
        ) : (
          <Badge>{event.status ?? "scheduled"}</Badge>
        )}
        {event.format && <Badge tone="brand">{event.format}</Badge>}
        {event.team_play && <Badge tone="info">Teams up to {event.max_team_size ?? 4}</Badge>}
        {event.solo_play && <Badge tone="info">Solo allowed</Badge>}
      </div>

      <h1 className="mt-5 font-display text-[clamp(32px,4.4vw,52px)] font-extrabold leading-[1.06] tracking-[-1.4px]">
        {event.name}
      </h1>

      {dates && (
        <p className="mt-4 text-[15px] text-text-faint">
          <time dateTime={event.starts_at ?? undefined}>{dates}</time>
          {" · "}
          {event.challenge_count ?? 0} challenges
          {typeof event.total_registered === "number" && event.total_registered > 0
            ? ` · ${event.total_registered} registered`
            : ""}
        </p>
      )}

      {event.description && (
        <p className="prose-reading mt-8 max-w-[720px] text-[17px] leading-[1.75] text-text-dim">
          {firstParagraph(event.description)}
        </p>
      )}

      <div className="mt-10 flex flex-wrap gap-3">
        <Link href={link("ctf", `/ctf/${event.slug}`)}>
          <Button size="lg">
            {event.status === "ended" ? "View the scoreboard" : "Register for this event"}
          </Button>
        </Link>
        <Link href={C.path}>
          <Button size="lg" variant="ghost">
            All competitions
          </Button>
        </Link>
      </div>

      <div className="mt-14 grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4">
        <Fact label="Format" value={event.format ?? "—"} />
        <Fact label="Challenges" value={String(event.challenge_count ?? 0)} />
        <Fact
          label="Entry"
          value={fee > 0 ? `${event.currency ?? "USD"} ${fee.toFixed(0)}` : "Free"}
        />
        <Fact
          label="Starts"
          value={event.starts_at ? formatDate(event.starts_at) : "TBA"}
        />
      </div>

      <Card className="mt-14 p-8" interactive={false}>
        <h2 className="font-display text-[20px] font-semibold">How this event is scored</h2>
        <p className="mt-3 text-[15px] leading-[1.75] text-text-dim">
          Challenges are worth a maximum value that decays towards a floor as more competitors
          solve them, so the reward tracks how hard a challenge proved to be rather than how hard
          the organiser guessed it would be. First blood carries a bonus. If the scoreboard is
          frozen before the end, standings stop updating publicly while solves still count — the
          final table is revealed when the event closes.
        </p>
      </Card>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg p-5">
      <div className="text-[11px] uppercase tracking-wide text-text-faint">{label}</div>
      <div className="mt-1.5 font-display text-[17px] font-semibold capitalize">{value}</div>
    </div>
  );
}

/**
 * Descriptions come out of the admin panel as Markdown, and a meta description
 * showing `# OFFCON 2026 — Capture` is worse than no description at all.
 * Stripping the syntax is enough here — this is one line of plain text, not a
 * render, so a Markdown dependency would be a lot of bundle for a substring.
 */
function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function firstParagraph(markdown: string): string {
  const text = plainText(markdown);
  return text.length > 480 ? `${text.slice(0, 477).trimEnd()}…` : text;
}

function summarise(event: PublicEvent): string {
  const base = event.description ? plainText(event.description) : "";
  if (base.length >= 60) return base.length > 158 ? `${base.slice(0, 155).trimEnd()}…` : base;
  const when = event.starts_at ? ` starting ${formatDate(event.starts_at)}` : "";
  return `${event.name} is a ${event.format ?? "Capture The Flag"} competition on OFFCON${when}, with ${event.challenge_count ?? 0} challenges to solve.`;
}
