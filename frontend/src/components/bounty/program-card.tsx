import Link from "next/link";
import { ShieldCheck, FileText, Clock } from "lucide-react";

import { Card } from "@/components/ui/card";
import { formatMoney, formatNumber } from "@/lib/format";
import type { BountyProgram } from "@/types/bounty";

export function ProgramCard({ program }: { program: BountyProgram }) {
  return (
    <Link href={`/bounty/${program.slug}`} className="block">
      <Card interactive className="group h-full overflow-hidden">
        <div className="relative h-20 overflow-hidden" style={{ background: `linear-gradient(120deg, ${program.bannerColor}, #2563EB)` }}>
          <div
            className="absolute inset-0 opacity-25"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,.2) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.2) 1px,transparent 1px)",
              backgroundSize: "22px 22px",
            }}
          />
          {program.safeHarbor && (
            <span className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-black/30 px-2 py-0.5 text-[10.5px] font-semibold text-white backdrop-blur">
              <ShieldCheck className="h-3 w-3" /> Safe harbor
            </span>
          )}
        </div>

        <div className="p-4">
          <h3 className="font-display text-[17px] font-bold">{program.name}</h3>
          <p className="text-[13px] text-text-faint">{program.orgName}</p>

          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="text-[12px] text-text-faint">Up to</span>
            <span className="font-display text-[18px] font-extrabold text-gradient">
              {formatMoney(program.maxRewardCents, program.currency)}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {program.tags.slice(0, 3).map((t) => (
              <span key={t} className="rounded-md bg-surface-hover px-2 py-0.5 text-[11.5px] font-medium text-text-dim">{t}</span>
            ))}
          </div>

          <div className="mt-3 flex items-center gap-4 border-t border-line pt-3 text-[12.5px] text-text-faint">
            <span className="flex items-center gap-1.5"><FileText className="h-3.5 w-3.5" /> {formatNumber(program.totalReports)} reports</span>
            <span className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> {program.responseSlaHours}h SLA</span>
          </div>
        </div>
      </Card>
    </Link>
  );
}
