"use client";

/**
 * Scope and rewards — the page that decides whether a finding is worth writing
 * up at all.
 *
 * Two blocks, in the order the decision is made: what each severity pays, then
 * exactly which assets that applies to. Out-of-scope assets are listed rather
 * than hidden, because "is this excluded?" is as important a question as "is
 * this included?" and a missing row answers neither.
 */

import { use, useMemo, useState } from "react";
import { Search } from "lucide-react";

import { Card, CardBody } from "@/components/ui/card";
import { SeverityBadge } from "@/components/bounty/status-badges";
import { useProgram } from "@/hooks/use-account";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { Severity } from "@/types/bounty";

const ORDER: Severity[] = ["low", "medium", "high", "critical"];

const ASSET_LABEL: Record<string, string> = {
  domain: "Domain",
  wildcard: "Wildcard",
  ip: "IP address",
  ip_range: "IP range",
  mobile_app: "Mobile app",
  source_code: "Source code",
  api: "API",
  other: "Other",
};

export default function ProgramScopePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const { data: program } = useProgram(slug);
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<"all" | "in" | "out">("all");

  const assets = useMemo(() => {
    const list = program?.scope ?? [];
    const needle = q.trim().toLowerCase();
    return list.filter((s) => {
      if (only === "in" && !s.inScope) return false;
      if (only === "out" && s.inScope) return false;
      if (needle && !s.assetIdentifier.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [program, q, only]);

  if (!program) return null;

  const tiers = ORDER.map((sev) => program.rewards.find((r) => r.severity === sev)).filter(
    (r): r is NonNullable<typeof r> => Boolean(r),
  );

  return (
    <div className="space-y-5">
      {tiers.length > 0 ? (
        <Card>
          <CardBody>
            <h2 className="font-display text-[17px] font-bold">Rewards</h2>
            <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              {tiers.map((t) => (
                <div key={t.severity} className="rounded-xl border border-line bg-surface p-3.5">
                  <SeverityBadge severity={t.severity} />
                  <p className="mt-2 font-display text-[17px] font-extrabold text-success">
                    {formatMoney(t.minCents, t.currency)} – {formatMoney(t.maxCents, t.currency)}
                  </p>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody>
            <h2 className="font-display text-[17px] font-bold">Rewards</h2>
            <p className="mt-1.5 text-[13.5px] text-text-dim">
              No reward bands published. Payouts, if any, are decided per report.
            </p>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-[17px] font-bold">Scope</h2>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Filter assets…"
                  className="h-9 w-[200px] rounded-lg border border-line-strong bg-bg-elevated pl-9 pr-3 text-[13.5px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
                />
              </div>
              <div className="flex rounded-lg border border-line-strong p-0.5">
                {(["all", "in", "out"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setOnly(v)}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-[12.5px] font-medium transition-colors",
                      only === v ? "bg-brand-gradient text-white" : "text-text-dim hover:text-text",
                    )}
                  >
                    {v === "all" ? "All" : v === "in" ? "In scope" : "Out"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {assets.length === 0 ? (
            <p className="mt-5 text-[13.5px] text-text-dim">
              {(program.scope ?? []).length === 0
                ? "This program has not declared any assets. Ask before testing anything."
                : "No assets match that filter."}
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-line text-[11.5px] uppercase tracking-wide text-text-faint">
                    <th className="pb-2 pr-3 font-semibold">Asset</th>
                    <th className="pb-2 pr-3 font-semibold">Type</th>
                    <th className="pb-2 pr-3 font-semibold">Max severity</th>
                    <th className="pb-2 font-semibold">Eligible</th>
                  </tr>
                </thead>
                <tbody>
                  {assets.map((s) => (
                    <tr
                      key={`${s.assetType}-${s.assetIdentifier}`}
                      className={cn("border-b border-line last:border-0", !s.inScope && "opacity-60")}
                    >
                      <td className="py-2.5 pr-3">
                        <code className="break-all font-mono text-[13px] text-text">
                          {s.assetIdentifier}
                        </code>
                        {s.notes && (
                          <p className="mt-0.5 text-[12px] text-text-faint">{s.notes}</p>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-[13px] text-text-dim">
                        {ASSET_LABEL[s.assetType] ?? s.assetType}
                      </td>
                      <td className="py-2.5 pr-3">
                        <SeverityBadge severity={s.severityMax} />
                      </td>
                      <td className="py-2.5">
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[11.5px] font-semibold",
                            s.inScope
                              ? "bg-success/12 text-success"
                              : "bg-danger/12 text-danger",
                          )}
                        >
                          {s.inScope ? "In scope" : "Out of scope"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
