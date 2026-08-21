"use client";

/**
 * Collaborators — who else is working this program.
 *
 * Unranked and unfiltered by outcome, unlike Thanks: this answers "who is
 * looking at this", and a rejected report answers that as well as an accepted
 * one does. Ordered by most recent activity, because who is here *now* is what
 * the question is really about.
 */

import { use } from "react";
import Link from "next/link";

import { Avatar } from "@/components/ui/identity";
import { Card, CardBody, Skeleton } from "@/components/ui/card";
import { useProgramCollaborators } from "@/hooks/use-account";
import { formatRelative } from "@/lib/format";

export default function ProgramCollaboratorsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const { data: people = [], isLoading } = useProgramCollaborators(slug);

  if (isLoading) return <Skeleton className="h-72 w-full rounded-2xl" />;

  if (people.length === 0) {
    return (
      <Card className="p-12 text-center">
        <p className="font-display text-[17px] font-bold">Nobody has reported yet</p>
        <p className="mt-1.5 text-[13.5px] text-text-dim">You could be the first.</p>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden p-0">
      <CardBody className="border-b border-line">
        <h1 className="font-display text-[17px] font-bold">Hackers</h1>
        <p className="mt-0.5 text-[13px] text-text-dim">
          {people.length} {people.length === 1 ? "person has" : "people have"} reported to this
          program.
        </p>
      </CardBody>
      {people.map((p) => (
        <div
          key={p.researcherId}
          className="flex items-center gap-3 border-b border-line px-5 py-3 last:border-0 hover:bg-surface-hover"
        >
          <Avatar username={p.username} size="sm" className="shrink-0" />
          <Link
            href={`/u/${p.username}`}
            className="min-w-0 flex-1 truncate font-display text-[14px] font-semibold hover:text-accent"
          >
            {p.username}
          </Link>
          <span className="shrink-0 text-[12.5px] text-text-faint">
            {p.reports} {p.reports === 1 ? "report" : "reports"}
          </span>
          <span className="hidden w-28 shrink-0 text-right text-[12px] text-text-ghost sm:block">
            {formatRelative(p.lastReportAt)}
          </span>
        </div>
      ))}
    </Card>
  );
}
