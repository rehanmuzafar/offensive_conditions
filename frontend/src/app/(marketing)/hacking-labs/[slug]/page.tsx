/**
 * One machine's public page.
 *
 * Strictly the outside of the box: name, operating system, difficulty, and how
 * many people have owned it. `intro_markdown`, `walkthrough_markdown`,
 * `expected_ports`, `image_ref` and the download fields all come back on the
 * same API row and none of them are rendered here — a walkthrough on a public
 * page would hand away the solution to the thing the page is advertising, and
 * the ports are a hint.
 *
 * Long-tail search is the whole argument for these pages existing. Nobody types
 * "offensive conditions"; people type "windows privilege escalation practice
 * box" and "active directory lab beginner", and a page naming one specific
 * machine with its OS and difficulty on it is the only thing on this domain
 * that can answer that.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { JsonLd } from "@/components/seo/json-ld";
import { CLUSTERS, absolute } from "@/lib/seo/config";
import { formatDate } from "@/lib/seo/format";
import { tagLabel } from "@/lib/format";
import { isIndexableMachine } from "@/lib/seo/indexable";
import {
  breadcrumbNode,
  graph,
  machineNode,
  organizationNode,
  webPageNode,
} from "@/lib/seo/jsonld";
import { indexableMachines, machineBySlug } from "@/lib/seo/public-data";
import { link } from "@/lib/surfaces";

const C = CLUSTERS.labs;

export const revalidate = 3600;

export async function generateStaticParams() {
  const machines = await indexableMachines();
  return machines.map((m) => ({ slug: m.slug }));
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const m = await machineBySlug(slug);
  if (!m) return { title: "Machine not found", robots: { index: false, follow: false } };

  const path = `${C.path}/${m.slug}`;
  const label = [m.difficulty?.replace(/_/g, " "), m.os].filter(Boolean).join(" ");
  const title = `${m.name} — ${label || "vulnerable"} machine`;
  const description =
    m.description?.trim() ||
    `${m.name} is a ${label || "vulnerable"} practice machine on OFFCON. Spawn it in an isolated sandbox and work it end to end, from enumeration to root.`;

  return {
    title,
    description: description.length > 158 ? `${description.slice(0, 155).trimEnd()}…` : description,
    alternates: { canonical: absolute(path) },
    robots: isIndexableMachine(m) ? undefined : { index: false, follow: true },
    openGraph: { title, description, url: absolute(path), type: "article" },
  };
}

export default async function MachinePage({ params }: Props) {
  const { slug } = await params;
  const m = await machineBySlug(slug);
  if (!m) notFound();

  const path = `${C.path}/${m.slug}`;
  const indexable = isIndexableMachine(m);

  return (
    <div className="mx-auto max-w-[900px] px-6 py-20">
      {indexable && (
        <JsonLd
          data={graph(
            organizationNode(),
            webPageNode(path, m.name, m.description ?? ""),
            breadcrumbNode([
              { name: "Home", path: "/" },
              { name: "Hacking labs", path: C.path },
              { name: m.name, path },
            ]),
            machineNode(m),
          )}
        />
      )}

      <nav aria-label="Breadcrumb" className="mb-8 text-[13px] text-text-faint">
        <Link href="/" className="hover:text-accent">
          Home
        </Link>
        <span className="mx-2">/</span>
        <Link href={C.path} className="hover:text-accent">
          Hacking labs
        </Link>
        <span className="mx-2">/</span>
        <span className="text-text-dim">{m.name}</span>
      </nav>

      <div className="flex flex-wrap items-center gap-2">
        {m.os && <Badge tone="info">{m.os}</Badge>}
        {m.difficulty && <Badge tone="brand">{m.difficulty.replace(/_/g, " ")}</Badge>}
        {m.tags?.slice(0, 4).map((t) => { const l = tagLabel(t); return l ? <Badge key={l}>{l}</Badge> : null; })}
      </div>

      <h1 className="mt-5 font-display text-[clamp(32px,4.4vw,52px)] font-extrabold leading-[1.06] tracking-[-1.4px]">
        {m.name}
      </h1>

      {m.description && (
        <p className="prose-reading mt-6 max-w-[720px] text-[17px] leading-[1.75] text-text-dim">
          {m.description}
        </p>
      )}

      <div className="mt-10 flex flex-wrap gap-3">
        <Link href={link("app", `/machines/${m.slug}`)}>
          <Button size="lg">Spawn this machine</Button>
        </Link>
        <Link href={C.path}>
          <Button size="lg" variant="ghost">
            All machines
          </Button>
        </Link>
      </div>

      <div className="mt-14 grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4">
        <Fact label="OS" value={m.os ?? "—"} />
        <Fact label="Difficulty" value={m.difficulty?.replace(/_/g, " ") ?? "—"} />
        <Fact label="Root owns" value={String(m.total_root_owns ?? 0)} />
        <Fact label="Released" value={m.released_at ? formatDate(m.released_at) : "—"} />
      </div>

      <Card className="mt-14 p-8" interactive={false}>
        <h2 className="font-display text-[20px] font-semibold">What solving this looks like</h2>
        <p className="mt-3 text-[15px] leading-[1.75] text-text-dim">
          You are given a network address on the lab VPN and nothing else. Enumerate what is
          listening, find the way in, and take a shell as an unprivileged user — that is the user
          flag. Then escalate: a misconfiguration, a vulnerable service, a credential left
          somewhere it should not be. Root is the second flag. Both are unique to your instance,
          so a flag from someone else&apos;s box will not verify against yours.
        </p>
        <p className="mt-4 text-[15px] leading-[1.75] text-text-dim">
          Community writeups for {m.name} unlock automatically once you have submitted the root
          flag yourself.
        </p>
      </Card>

      <p className="mt-10 text-[13px] leading-[1.7] text-text-faint">
        This machine runs sandboxed under gVisor on a segmented lab network. Techniques you
        practise here are legal against this system and against nothing else — testing a system
        without written authorisation is a criminal offence in most jurisdictions.
      </p>
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
