/**
 * One track's public page.
 *
 * The outside of a track: what it covers, how long it runs, what it assumes.
 * The modules themselves stay behind the gate — a module list with its gating
 * flags is product, and the `Course` node only needs the shape of the thing.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { JsonLd } from "@/components/seo/json-ld";
import { CLUSTERS, absolute } from "@/lib/seo/config";
import { isIndexablePath } from "@/lib/seo/indexable";
import {
  breadcrumbNode,
  courseNode,
  graph,
  organizationNode,
  webPageNode,
} from "@/lib/seo/jsonld";
import { indexablePaths, pathBySlug } from "@/lib/seo/public-data";
import { link } from "@/lib/surfaces";

const C = CLUSTERS.training;

export const revalidate = 3600;

export async function generateStaticParams() {
  const paths = await indexablePaths();
  return paths.map((p) => ({ slug: p.slug }));
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const p = await pathBySlug(slug);
  if (!p) return { title: "Track not found", robots: { index: false, follow: false } };

  const path = `${C.path}/${p.slug}`;
  const title = `${p.name} — offensive security track`;
  const description =
    p.description?.trim() ||
    `${p.name} is a guided offensive security track on OFFCON, built from hands-on modules that each end on a real, breakable machine.`;

  return {
    title,
    description: description.length > 158 ? `${description.slice(0, 155).trimEnd()}…` : description,
    alternates: { canonical: absolute(path) },
    robots: isIndexablePath(p) ? undefined : { index: false, follow: true },
    openGraph: { title, description, url: absolute(path), type: "article" },
  };
}

export default async function TrackPage({ params }: Props) {
  const { slug } = await params;
  const p = await pathBySlug(slug);
  if (!p) notFound();

  const path = `${C.path}/${p.slug}`;

  return (
    <div className="mx-auto max-w-[900px] px-6 py-20">
      {isIndexablePath(p) && (
        <JsonLd
          data={graph(
            organizationNode(),
            webPageNode(path, p.name, p.description ?? ""),
            breadcrumbNode([
              { name: "Home", path: "/" },
              { name: "Training", path: C.path },
              { name: p.name, path },
            ]),
            courseNode(p),
          )}
        />
      )}

      <nav aria-label="Breadcrumb" className="mb-8 text-[13px] text-text-faint">
        <Link href="/" className="hover:text-accent">
          Home
        </Link>
        <span className="mx-2">/</span>
        <Link href={C.path} className="hover:text-accent">
          Training
        </Link>
        <span className="mx-2">/</span>
        <span className="text-text-dim">{p.name}</span>
      </nav>

      {p.difficulty && <Badge tone="brand">{p.difficulty}</Badge>}

      <h1 className="mt-5 font-display text-[clamp(32px,4.4vw,52px)] font-extrabold leading-[1.06] tracking-[-1.4px]">
        {p.name}
      </h1>

      {p.description && (
        <p className="prose-reading mt-6 max-w-[720px] text-[17px] leading-[1.75] text-text-dim">
          {p.description}
        </p>
      )}

      <div className="mt-10 flex flex-wrap gap-3">
        <Link href={link("app", `/tracks/${p.slug}`)}>
          <Button size="lg">Start this track</Button>
        </Link>
        <Link href={C.path}>
          <Button size="lg" variant="ghost">
            All tracks
          </Button>
        </Link>
      </div>

      <div className="mt-14 grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4">
        <Fact label="Level" value={p.difficulty ?? "—"} />
        <Fact label="Modules" value={String(p.module_count ?? 0)} />
        <Fact label="Machines" value={String(p.machine_count ?? 0)} />
        <Fact label="Est. time" value={p.estimated_hours ? `${p.estimated_hours}h` : "—"} />
      </div>

      <Card className="mt-14 p-8" interactive={false}>
        <h2 className="font-display text-[20px] font-semibold">How a module is gated</h2>
        <p className="mt-3 text-[15px] leading-[1.75] text-text-dim">
          Each module pairs a written section with a machine carrying the vulnerability class it
          covers. The next module opens when you submit the flag from that machine — not when you
          scroll to the bottom. It means the track cannot be completed passively, and that a
          finished track is a claim about what you can do rather than about what you have seen.
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
