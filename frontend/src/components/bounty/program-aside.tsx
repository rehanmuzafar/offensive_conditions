"use client";

/**
 * The program panel that stays put across all seven sub-pages.
 *
 * Every one of those pages is something you read *about* a program — its
 * policy, its scope, who it thanked — and on all of them the two things you
 * actually want to act on are the same: who is this, and how do I submit. So
 * they live in a rail that does not move, instead of being repeated in seven
 * page headers.
 */

import Link from "next/link";
import { ExternalLink, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProgramMark } from "@/components/bounty/program-card";
import { formatMoney } from "@/lib/format";
import type { BountyProgramDetail } from "@/types/bounty";

export function ProgramAside({ program }: { program: BountyProgramDetail }) {
  const pays = program.maxRewardCents > 0;

  return (
    <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
      <Card className="edge-iridescent p-5">
        <div className="flex items-center gap-3">
          <ProgramMark name={program.name} slug={program.slug} size={44} />
          <h2 className="min-w-0 font-display text-[19px] font-bold tracking-[-0.3px]">
            {program.name}
          </h2>
        </div>

        <p className="mt-3 text-[13.5px] leading-relaxed text-text-dim">
          {program.description}
        </p>

        <dl className="mt-4 space-y-2 border-t border-line pt-4 text-[13px]">
          <Row label="Launched" value={program.publishedAt ? new Date(program.publishedAt).toLocaleDateString(undefined, { month: "long", year: "numeric" }) : "Not yet"} />
          <Row
            label="Disclosure"
            value={<span className="capitalize">{program.disclosurePolicy.replace(/_/g, " ")}</span>}
          />
          <Row label="Response SLA" value={`${program.responseSlaHours} hours`} />
          <Row label="Triage SLA" value={`${program.triageSlaHours} hours`} />
          <Row label="Resolution" value={`${program.resolutionSlaDays} days`} />
        </dl>

        <div className="mt-5 space-y-2">
          <Link href={`/bounty/${program.slug}/submit`} className="block">
            <Button fullWidth size="lg">
              <Send className="h-[18px] w-[18px]" /> Submit report
            </Button>
          </Link>
          <Link
            href={`/bounty/${program.slug}/scope`}
            className="flex items-center justify-center gap-1.5 py-1 text-[13px] text-text-dim hover:text-text"
          >
            Check the scope first <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="font-display text-[15px] font-bold">Stats</h3>
        <dl className="mt-3 space-y-2.5 text-[13px]">
          <Row label="Reports received" value={program.totalReports.toLocaleString()} />
          <Row
            label="Total paid"
            value={formatMoney(program.totalPaidCents, program.currency)}
          />
          <Row
            label="Reward range"
            value={
              pays
                ? `${formatMoney(program.minRewardCents, program.currency)} – ${formatMoney(program.maxRewardCents, program.currency)}`
                : "No bounty"
            }
          />
        </dl>
      </Card>
    </aside>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-text-faint">{label}</dt>
      <dd className="text-right font-medium text-text">{value}</dd>
    </div>
  );
}
