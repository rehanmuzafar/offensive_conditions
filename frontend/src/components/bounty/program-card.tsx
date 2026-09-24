"use client";

/**
 * A program as the discovery grid shows it.
 *
 * The card answers the four questions a hacker asks before opening anything:
 * what can I test (scope chips), what does it pay (the range), how busy is it
 * (reports and hackers), and will they actually answer me (response
 * efficiency). Everything on it is measured — see `ProgramService.card_stats`.
 *
 * Replaces the earlier card, which showed a banner colour, an organisation name
 * and tags. Two of those three had no field behind them at all.
 */

import Link from "next/link";
import { Bug, ShieldCheck, Star, Users } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatMoney, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { BountyProgram } from "@/types/bounty";

/** Asset types, shortened to what fits a chip. */
const ASSET_LABEL: Record<string, string> = {
  domain: "Domain",
  wildcard: "Wildcard",
  ip: "IP",
  ip_range: "IP range",
  mobile_app: "Mobile",
  source_code: "SourceCode",
  api: "API",
  other: "Other",
};

export function ProgramCard({
  program,
  bookmarked = false,
  onToggleBookmark,
}: {
  program: BountyProgram;
  bookmarked?: boolean;
  onToggleBookmark?: (slug: string) => void;
}) {
  const pays = program.maxRewardCents > 0;

  return (
    <Card className="edge-iridescent group flex h-full flex-col overflow-hidden transition-transform duration-300 hover:-translate-y-1">
      {/* header */}
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
        <ProgramMark name={program.name} slug={program.slug} />
        <Link
          href={`/bounty/${program.slug}`}
          className="min-w-0 flex-1 truncate font-display text-[15px] font-bold tracking-[-0.2px] text-text hover:text-accent"
        >
          {program.name}
        </Link>
        {onToggleBookmark && (
          <button
            onClick={() => onToggleBookmark(program.slug)}
            aria-label={bookmarked ? "Remove bookmark" : "Bookmark program"}
            aria-pressed={bookmarked}
            className={cn(
              "shrink-0 rounded-lg p-1 transition-colors",
              bookmarked ? "text-accent" : "text-text-ghost hover:text-text",
            )}
          >
            <Star className={cn("h-4 w-4", bookmarked && "fill-current")} />
          </button>
        )}
      </div>

      <div className="flex flex-1 flex-col p-4">
        <p className="text-[12.5px] font-semibold text-text">
          {pays ? "Bounty" : "Vulnerability disclosure"}
        </p>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-text-dim">
          {[
            program.safeHarbor && "Safe harbor",
            `${program.disclosurePolicy.replace(/_/g, " ")} disclosure`,
            `${program.responseSlaHours}h response SLA`,
          ]
            .filter(Boolean)
            .join(", ")}
        </p>

        {/* scope breakdown */}
        {program.assetCounts.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {program.assetCounts.slice(0, 6).map((a) => (
              <span
                key={a.assetType}
                className="flex items-center gap-1.5 rounded-md bg-surface-hover px-2 py-0.5 text-[11.5px] text-text-dim"
              >
                {ASSET_LABEL[a.assetType] ?? a.assetType}
                <span className="font-semibold text-text-faint">{a.count}</span>
              </span>
            ))}
          </div>
        )}

        {program.safeHarbor && (
          <p className="mt-3 flex items-center gap-1.5 text-[12.5px] font-medium text-accent">
            <ShieldCheck className="h-3.5 w-3.5" /> Gold standard safe harbor
          </p>
        )}

        <p className="mt-2 font-display text-[19px] font-extrabold text-success">
          {pays
            ? `${formatMoney(program.minRewardCents, program.currency)} – ${formatMoney(
                program.maxRewardCents,
                program.currency,
              )}`
            : "No bounty"}
        </p>

        {/* activity */}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-text-faint">
          <span className="flex items-center gap-1.5" title="Reports received">
            <Bug className="h-3.5 w-3.5" /> {formatNumber(program.totalReports)}
          </span>
          <span className="flex items-center gap-1.5" title="Hackers who have reported">
            <Users className="h-3.5 w-3.5" /> {formatNumber(program.hackers)}
          </span>
          <ResponseEfficiency value={program.responseEfficiency} />
        </div>

        <div className="mt-4 flex-1" />
        <Link href={`/bounty/${program.slug}`} className="block">
          <Button variant="ghost" fullWidth size="sm">
            See details
          </Button>
        </Link>
      </div>
    </Card>
  );
}

/**
 * How reliably the program answers, as a traffic light.
 *
 * Null is a real answer and gets its own treatment: it means no report is old
 * enough for the SLA to have expired, so there is nothing to judge. Rendering
 * that as 0% would libel a new program, and as 100% would flatter it.
 */
function ResponseEfficiency({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <span className="flex items-center gap-1.5" title="Not enough reports yet to measure">
        <span aria-hidden className="h-2 w-2 rounded-full bg-text-ghost" />
        No data
      </span>
    );
  }
  const pct = Math.round(value * 100);
  const tone = pct >= 80 ? "bg-success" : pct >= 50 ? "bg-warning" : "bg-danger";
  return (
    <span
      className="flex items-center gap-1.5"
      title="Share of reports answered inside the program's response SLA"
    >
      <span aria-hidden className={cn("h-2 w-2 rounded-full", tone)} />
      {pct}%
    </span>
  );
}

/**
 * The program's mark.
 *
 * Programs have no uploaded logo, so this is initials on a ground derived from
 * the slug — stable across renders and distinct enough to tell a grid of twenty
 * apart at a glance.
 */
export function ProgramMark({
  name,
  slug,
  size = 32,
}: {
  name: string;
  slug: string;
  size?: number;
}) {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) % 360;
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-lg font-display font-bold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: `linear-gradient(135deg, hsl(${h} 62% 42%), hsl(${(h + 40) % 360} 62% 30%))`,
      }}
    >
      {initials}
    </span>
  );
}
