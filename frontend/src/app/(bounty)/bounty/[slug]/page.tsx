"use client";

/**
 * Program guidelines — the program's front page.
 *
 * Leads with what a hacker must agree to before testing, then the numbers that
 * say whether the program is worth their time. Both come from the program's own
 * declared policy and SLAs; nothing here is inferred.
 */

import { use } from "react";
import {
  Clock,
  FileCheck,
  Mail,
  ScrollText,
  ShieldCheck,
  Timer,
} from "lucide-react";

import { Card, CardBody } from "@/components/ui/card";
import { Markdown } from "@/components/ui/markdown";
import { useProgram } from "@/hooks/use-account";

export default function ProgramGuidelinesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const { data: program } = useProgram(slug);
  if (!program) return null;

  return (
    <div className="space-y-5">
      <Card>
        <CardBody>
          <h1 className="font-display text-[19px] font-bold tracking-[-0.3px]">Introduction</h1>
          <p className="mt-2 text-[14.5px] leading-relaxed text-text-dim">
            {program.description}
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <h2 className="font-display text-[17px] font-bold">Program highlights</h2>
          <dl className="mt-4 space-y-3">
            <Highlight
              icon={<ScrollText className="h-4 w-4" />}
              label="Disclosure policy"
              value={<span className="capitalize">{program.disclosurePolicy.replace(/_/g, " ")}</span>}
            />
            <Highlight
              icon={<ShieldCheck className="h-4 w-4" />}
              label="Safe harbor"
              value={
                program.safeHarbor
                  ? "Good-faith research is protected under this program."
                  : "Not offered — check with the program before testing."
              }
            />
            <Highlight
              icon={<Mail className="h-4 w-4" />}
              label="Scope"
              value={
                program.scope.length > 0
                  ? `${program.scope.filter((s) => s.inScope).length} assets in scope`
                  : "No assets declared yet"
              }
            />
          </dl>

          <div className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-5 lg:grid-cols-3">
            <Tile
              icon={<Clock className="h-4 w-4" />}
              value={`${program.responseSlaHours}h`}
              label="Target first response"
            />
            <Tile
              icon={<FileCheck className="h-4 w-4" />}
              value={`${program.triageSlaHours}h`}
              label="Target time to triage"
            />
            <Tile
              icon={<Timer className="h-4 w-4" />}
              value={`${program.resolutionSlaDays}d`}
              label="Target time to resolve"
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <h2 className="font-display text-[17px] font-bold">Policy</h2>
          <p className="mt-1 text-[12.5px] text-text-faint">
            Read this before testing. Anything outside it is not authorised.
          </p>
          <div className="mt-3">
            <Markdown>{program.policy || "_This program has not published a policy yet._"}</Markdown>
          </div>
        </CardBody>
      </Card>

      {(program.inScopeSummary || program.outOfScopeSummary) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {program.inScopeSummary && (
            <Card>
              <CardBody>
                <h3 className="font-display text-[15px] font-bold text-success">In scope</h3>
                <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-relaxed text-text-dim">
                  {program.inScopeSummary}
                </p>
              </CardBody>
            </Card>
          )}
          {program.outOfScopeSummary && (
            <Card>
              <CardBody>
                <h3 className="font-display text-[15px] font-bold text-danger">Out of scope</h3>
                <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-relaxed text-text-dim">
                  {program.outOfScopeSummary}
                </p>
              </CardBody>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function Highlight({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-line bg-white/5 text-text-dim">
        {icon}
      </span>
      <div className="min-w-0">
        <dt className="text-[13px] font-semibold text-text">{label}</dt>
        <dd className="text-[13px] text-text-dim">{value}</dd>
      </div>
    </div>
  );
}

function Tile({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3.5 text-center">
      <span className="mx-auto grid h-7 w-7 place-items-center text-text-faint">{icon}</span>
      <p className="mt-1 font-display text-[20px] font-extrabold tracking-[-0.4px]">{value}</p>
      <p className="mt-0.5 text-[11.5px] leading-tight text-text-faint">{label}</p>
    </div>
  );
}
