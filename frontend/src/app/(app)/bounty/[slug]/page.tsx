"use client";

import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ShieldCheck, FileText, Clock, DollarSign, CheckCircle2, XCircle, Send, ScrollText, Crosshair } from "lucide-react";

import { Card, CardBody, Skeleton } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SeverityBadge } from "@/components/bounty/status-badges";
import { useProgram } from "@/hooks/use-account";
import { formatMoney, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";

type Tab = "overview" | "scope" | "rewards";

export default function ProgramDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { data: program, isLoading } = useProgram(slug);
  const [tab, setTab] = useState<Tab>("overview");

  if (isLoading || !program) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link href="/bounty" className="inline-flex items-center gap-1.5 text-[14px] text-text-dim hover:text-text">
        <ArrowLeft className="h-4 w-4" /> All programs
      </Link>

      {/* hero */}
      <Card className="overflow-hidden">
        <div className="relative h-28" style={{ background: `linear-gradient(120deg, ${program.bannerColor}, #2563EB)` }}>
          <div
            className="absolute inset-0 opacity-25"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,.2) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.2) 1px,transparent 1px)",
              backgroundSize: "26px 26px",
            }}
          />
        </div>
        <CardBody>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="font-display text-[28px] font-extrabold tracking-[-0.5px]">{program.name}</h1>
              <p className="mt-1 text-[14.5px] text-text-faint">{program.orgName}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {program.safeHarbor && (
                  <span className="flex items-center gap-1.5 rounded-full bg-success/12 px-2.5 py-0.5 text-[12px] font-semibold text-success">
                    <ShieldCheck className="h-3.5 w-3.5" /> Safe harbor
                  </span>
                )}
                <span className="rounded-full bg-surface-hover px-2.5 py-0.5 text-[12px] font-semibold capitalize text-text-dim">
                  {program.visibility.replace("_", " ")}
                </span>
                {program.tags.map((t) => (
                  <span key={t} className="rounded-md bg-surface-hover px-2 py-0.5 text-[11.5px] font-medium text-text-dim">{t}</span>
                ))}
              </div>
            </div>
            <Link href={`/bounty/${slug}/submit`}>
              <Button size="lg"><Send className="h-[18px] w-[18px]" /> Submit report</Button>
            </Link>
          </div>

          {/* stat strip */}
          <div className="mt-5 grid grid-cols-2 gap-4 border-t border-line pt-4 sm:grid-cols-4">
            <Stat icon={<DollarSign className="h-4 w-4" />} label="Max reward" value={formatMoney(program.maxRewardCents, program.currency)} />
            <Stat icon={<FileText className="h-4 w-4" />} label="Reports" value={formatNumber(program.totalReports)} />
            <Stat icon={<DollarSign className="h-4 w-4" />} label="Total paid" value={formatMoney(program.totalPaidCents, program.currency)} />
            <Stat icon={<Clock className="h-4 w-4" />} label="Response SLA" value={`${program.responseSlaHours}h`} />
          </div>
        </CardBody>
      </Card>

      {/* tabs */}
      <div className="flex rounded-xl border border-line-strong p-0.5 w-fit">
        <TabBtn active={tab === "overview"} onClick={() => setTab("overview")} icon={<ScrollText className="h-4 w-4" />} label="Policy" />
        <TabBtn active={tab === "scope"} onClick={() => setTab("scope")} icon={<Crosshair className="h-4 w-4" />} label="Scope" />
        <TabBtn active={tab === "rewards"} onClick={() => setTab("rewards")} icon={<DollarSign className="h-4 w-4" />} label="Rewards" />
      </div>

      {tab === "overview" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Card>
              <CardBody>
                <h3 className="mb-3 font-display text-[17px] font-bold">About</h3>
                <p className="text-[15px] leading-relaxed text-text-dim">{program.description}</p>
                <h3 className="mb-3 mt-6 font-display text-[17px] font-bold">Policy</h3>
                <p className="text-[15px] leading-relaxed text-text-dim">{program.policy}</p>
              </CardBody>
            </Card>
          </div>
          <div className="space-y-4">
            <Card>
              <CardBody>
                <h4 className="mb-2 flex items-center gap-2 font-display text-[15px] font-bold text-success">
                  <CheckCircle2 className="h-4 w-4" /> In scope
                </h4>
                <p className="text-[13.5px] text-text-dim">{program.inScopeSummary}</p>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <h4 className="mb-2 flex items-center gap-2 font-display text-[15px] font-bold text-danger">
                  <XCircle className="h-4 w-4" /> Out of scope
                </h4>
                <p className="text-[13.5px] text-text-dim">{program.outOfScopeSummary}</p>
              </CardBody>
            </Card>
          </div>
        </div>
      )}

      {tab === "scope" && (
        <Card className="overflow-hidden p-0">
          <div className="grid grid-cols-[1fr_100px_90px] gap-3 border-b border-line px-5 py-3 text-[12px] font-bold uppercase tracking-[1px] text-text-faint sm:grid-cols-[140px_1fr_110px_90px]">
            <span className="hidden sm:block">Type</span>
            <span>Asset</span>
            <span>Max severity</span>
            <span className="text-right">In scope</span>
          </div>
          {program.scope.map((s, i) => (
            <div key={i} className="grid grid-cols-[1fr_100px_90px] items-center gap-3 border-b border-line px-5 py-3.5 last:border-0 sm:grid-cols-[140px_1fr_110px_90px]">
              <span className="hidden text-[13px] capitalize text-text-faint sm:block">{s.assetType.replace("_", " ")}</span>
              <div className="min-w-0">
                <code className="block truncate font-mono text-[13.5px] text-text">{s.assetIdentifier}</code>
                {s.notes && <span className="text-[12px] text-text-faint">{s.notes}</span>}
              </div>
              <SeverityBadge severity={s.severityMax} />
              <span className="text-right">
                {s.inScope ? <CheckCircle2 className="ml-auto h-5 w-5 text-success" /> : <XCircle className="ml-auto h-5 w-5 text-danger" />}
              </span>
            </div>
          ))}
        </Card>
      )}

      {tab === "rewards" && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {program.rewards.map((r) => (
            <Card key={r.severity}>
              <CardBody className="text-center">
                <SeverityBadge severity={r.severity} />
                <div className="mt-4 font-display text-[24px] font-extrabold text-gradient">
                  {formatMoney(r.maxCents, r.currency)}
                </div>
                <div className="mt-1 text-[12.5px] text-text-faint">
                  from {formatMoney(r.minCents, r.currency)}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[12px] text-text-faint">{icon} {label}</div>
      <div className="mt-1 font-display text-[18px] font-extrabold">{value}</div>
    </div>
  );
}

function TabBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick} className={cn("flex items-center gap-2 rounded-lg px-4 py-2 text-[13.5px] font-semibold transition-colors", active ? "bg-brand-gradient text-white" : "text-text-dim hover:text-text")}>
      {icon} {label}
    </button>
  );
}
