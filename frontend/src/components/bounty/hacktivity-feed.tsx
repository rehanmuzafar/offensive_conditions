"use client";

/**
 * The disclosed-report feed, shared by the global Hacktivity section and each
 * program's own hacktivity tab.
 *
 * One component because the two are the same list with a different filter, and
 * the program page's version differing in layout would make it harder to read
 * for no reason.
 */

import Link from "next/link";

import { Card } from "@/components/ui/card";
import { SeverityBadge, ReportStateBadge } from "@/components/bounty/status-badges";
import { ProgramMark } from "@/components/bounty/program-card";
import { formatMoney, formatRelative } from "@/lib/format";
import type { HacktivityItem } from "@/types/bounty";

export function HacktivityFeed({
  items,
  showProgram = true,
  emptyHint,
}: {
  items: HacktivityItem[];
  /** Off on a program's own tab, where every row is the same program. */
  showProgram?: boolean;
  emptyHint?: string;
}) {
  if (items.length === 0) {
    return (
      <Card className="p-12 text-center">
        <p className="font-display text-[17px] font-bold">Nothing disclosed yet</p>
        <p className="mx-auto mt-1.5 max-w-md text-[13.5px] leading-relaxed text-text-dim">
          {emptyHint ??
            "Reports appear here once a program and the researcher agree to make them public."}
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((r) => (
        <Card key={r.id} className="edge-iridescent p-4 transition-transform duration-300 hover:-translate-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            {showProgram && (
              <Link
                href={`/bounty/${r.programSlug}`}
                className="flex items-center gap-1.5 text-[12.5px] font-medium text-text-dim hover:text-text"
              >
                <ProgramMark name={r.programName} slug={r.programSlug} size={18} />
                {r.programName}
              </Link>
            )}
            <SeverityBadge severity={r.severity} />
            <ReportStateBadge state={r.state} />
            {r.bountyCents > 0 && (
              <span className="rounded bg-success/12 px-1.5 py-0.5 text-[11.5px] font-semibold text-success">
                {formatMoney(r.bountyCents, r.bountyCurrency ?? "USD")}
              </span>
            )}
            <span className="ml-auto text-[12px] text-text-faint">
              {formatRelative(r.publishedAt)}
            </span>
          </div>

          <Link
            href={`/bounty/reports/${r.id}`}
            className="mt-2 block font-display text-[15.5px] font-semibold leading-snug hover:text-accent"
          >
            {r.title}
          </Link>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[12.5px] text-text-faint">
            <span>
              Found by{" "}
              <Link href={`/u/${r.researcherName}`} className="text-text-dim hover:text-accent">
                {r.researcherName}
              </Link>
            </span>
            {r.vrtCategory && (
              <>
                <span aria-hidden>·</span>
                <span>{r.vrtCategory}</span>
              </>
            )}
            <span aria-hidden>·</span>
            <code className="font-mono text-[11.5px]">{r.shortId}</code>
          </div>
        </Card>
      ))}
    </div>
  );
}
