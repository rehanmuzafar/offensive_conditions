"use client";

import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, X, Copy, DollarSign } from "lucide-react";

import { Card, CardBody, Skeleton } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { Avatar } from "@/components/ui/identity";
import { SeverityBadge, ReportStateBadge } from "@/components/bounty/status-badges";
import { useReport, useReportComments, useReportTimeline } from "@/hooks/use-account";
import { useTriageReport, useAwardBounty } from "@/hooks/use-admin";
import { formatRelative, formatMoney } from "@/lib/format";
import type { ReportState, Severity } from "@/types/bounty";
import { cn } from "@/lib/cn";

const SEVERITIES: Severity[] = ["low", "medium", "high", "critical"];

export default function AdminReportTriagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: report, isLoading } = useReport(id);
  const { data: comments = [] } = useReportComments(id);
  const { data: timeline = [] } = useReportTimeline(id);
  const triage = useTriageReport();
  const award = useAwardBounty();
  const [amount, setAmount] = useState("");

  if (isLoading || !report) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link href="/admin/bounty" className="inline-flex items-center gap-1.5 text-[14px] text-text-dim hover:text-text">
        <ArrowLeft className="h-4 w-4" /> Triage queue
      </Link>

      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded bg-surface-hover px-1.5 py-0.5 font-mono text-[12px] text-text-dim">{report.shortId}</code>
            <SeverityBadge severity={report.severity} />
            <ReportStateBadge state={report.state} />
            {report.cvssScore != null && <span className="text-[12.5px] font-semibold text-text-faint">CVSS {report.cvssScore.toFixed(1)}</span>}
          </div>
          <h1 className="mt-2 font-display text-[24px] font-extrabold leading-tight tracking-[-0.5px]">{report.title}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 text-[13px] text-text-faint">
            <span>{report.programName}</span>
            <code className="font-mono">{report.assetIdentifier}</code>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* left: content */}
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardBody>
              <Section title="Description"><Markdown>{report.descriptionMd}</Markdown></Section>
              <Section title="Steps to reproduce">
                <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl border border-line bg-bg-elevated p-4 font-mono text-[13px] text-text">{report.reproductionSteps}</pre>
              </Section>
              <Section title="Impact"><p className="text-[14.5px] text-text-dim">{report.impact}</p></Section>
              {report.cvssVector && (
                <Section title="CVSS vector">
                  <code className="block rounded-lg border border-line bg-bg-elevated px-3 py-2 font-mono text-[13px] text-accent">{report.cvssVector}</code>
                </Section>
              )}
            </CardBody>
          </Card>

          {/* comments */}
          <Card>
            <CardBody>
              <h3 className="mb-4 font-display text-[16px] font-bold">Discussion</h3>
              <div className="space-y-4">
                {comments.length === 0 && (
                  <p className="text-[13px] text-text-dim">No comments on this report yet.</p>
                )}
                {comments.map((c) => (
                  <div key={c.id} className="flex gap-3">
                    <Avatar username={c.authorName} size="sm" className="mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-display text-[13.5px] font-semibold">{c.authorName}</span>
                        {c.visibility === "internal" && <span className="rounded bg-warning/12 px-1.5 py-0.5 text-[10.5px] font-semibold text-warning">Internal</span>}
                        <span className="text-[11.5px] text-text-faint">{formatRelative(c.createdAt)}</span>
                      </div>
                      <div className="mt-1"><Markdown className="text-[14px]">{c.bodyMd}</Markdown></div>
                    </div>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        </div>

        {/* right: triage actions */}
        <div className="space-y-6">
          <TriagePanel
            id={id}
            state={report.state}
            severity={report.severity}
            triage={triage}
          />

          {/* award bounty */}
          <Card>
            <CardBody>
              <h3 className="mb-1 flex items-center gap-2 font-display text-[15px] font-bold">
                <DollarSign className="h-4 w-4 text-accent" /> Award bounty
              </h3>
              <p className="mb-3 text-[12.5px] text-text-faint">Set the payout amount for this report.</p>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-faint">$</span>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0"
                    className="h-10 w-full rounded-xl border border-line-strong bg-bg-elevated pl-7 pr-3 text-[14px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                  />
                </div>
                <Button
                  size="sm"
                  loading={award.isPending}
                  disabled={!amount || Number(amount) <= 0}
                  onClick={() => award.mutate({ id, amountCents: Math.round(Number(amount) * 100) })}
                >
                  Award
                </Button>
              </div>
              {report.bountyCents > 0 && (
                <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-success/10 px-3 py-2 text-[13px] text-success">
                  <Check className="h-4 w-4" /> {formatMoney(report.bountyCents, report.bountyCurrency ?? "USD")} awarded
                </div>
              )}
            </CardBody>
          </Card>

          {/* state timeline */}
          <Card>
            <CardBody>
              <h3 className="mb-3 font-display text-[15px] font-bold">History</h3>
              <ol className="relative space-y-4 border-l border-line pl-4">
                {timeline.length === 0 && (
                  <li className="text-[12.5px] text-text-dim">Nothing recorded yet.</li>
                )}
                {timeline.map((t) => (
                  <li key={t.id} className="relative">
                    <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-brand-gradient ring-2 ring-bg" />
                    <div className="text-[13px] font-semibold capitalize">{t.toState.replace("_", " ")}</div>
                    <div className="text-[11.5px] text-text-faint">{t.actorName} · {formatRelative(t.at)}</div>
                    {t.reason && <div className="mt-0.5 text-[12px] text-text-dim">{t.reason}</div>}
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5 last:mb-0">
      <h3 className="mb-2 font-display text-[15px] font-bold">{title}</h3>
      {children}
    </div>
  );
}


/**
 * The triage controls.
 *
 * Not a row of state buttons: bounty-svc models each decision as its own verb
 * because each needs different information — an acceptance sets the final
 * severity, a rejection requires a reason of at least ten characters, a
 * duplicate needs the report it duplicates. The old panel posted a bare target
 * state to an endpoint that does not exist, so nothing it offered worked.
 *
 * Which controls appear follows the state machine, so a triager is never shown
 * a move the service will refuse.
 */
function TriagePanel({
  id,
  state,
  severity,
  triage,
}: {
  id: string;
  state: ReportState;
  severity: Severity;
  triage: ReturnType<typeof useTriageReport>;
}) {
  const [chosen, setChosen] = useState<Severity>(severity);
  const [reason, setReason] = useState("");
  const [dupId, setDupId] = useState("");
  const [open, setOpen] = useState<"reject" | "duplicate" | null>(null);

  const canClaim = state === "submitted";
  const canDecide = state === "triaging";
  const canResolve = state === "accepted";
  const settled = !canClaim && !canDecide && !canResolve;

  return (
    <Card>
      <CardBody>
        <h3 className="mb-3 font-display text-[15px] font-bold">Triage actions</h3>

        {settled && (
          <p className="text-[13px] text-text-dim">
            This report is <span className="font-semibold text-text">{state}</span>. No further
            triage actions apply.
          </p>
        )}

        {canClaim && (
          <Button
            size="sm"
            fullWidth
            loading={triage.claim.isPending}
            onClick={() => triage.claim.mutate(id)}
          >
            Start triage
          </Button>
        )}

        {canDecide && (
          <div className="space-y-3">
            <div>
              <label className="text-[11.5px] font-semibold uppercase tracking-wide text-text-faint">
                Final severity
              </label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {SEVERITIES.map((sv) => (
                  <button
                    key={sv}
                    onClick={() => setChosen(sv)}
                    className={cn(
                      "rounded-lg border px-2.5 py-1 text-[12.5px] font-semibold capitalize transition-colors",
                      chosen === sv
                        ? "border-accent bg-accent/12 text-accent"
                        : "border-line text-text-dim hover:text-text",
                    )}
                  >
                    {sv}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[11.5px] text-text-faint">
                Only low and above count toward a researcher&apos;s leaderboard total.
              </p>
            </div>

            <Button
              size="sm"
              fullWidth
              loading={triage.accept.isPending}
              onClick={() => triage.accept.mutate({ id, severity: chosen })}
            >
              <Check className="h-4 w-4" /> Accept
            </Button>

            <Button size="sm" variant="ghost" fullWidth onClick={() => setOpen(open === "duplicate" ? null : "duplicate")}>
              <Copy className="h-4 w-4" /> Duplicate
            </Button>
            {open === "duplicate" && (
              <div className="space-y-2">
                <input
                  value={dupId}
                  onChange={(e) => setDupId(e.target.value)}
                  placeholder="Original report id"
                  className={FIELD}
                />
                <Button
                  size="sm"
                  fullWidth
                  disabled={!dupId.trim()}
                  loading={triage.duplicate.isPending}
                  onClick={() => triage.duplicate.mutate({ id, duplicateOfId: dupId.trim() })}
                >
                  Mark duplicate
                </Button>
              </div>
            )}

            <Button size="sm" variant="danger" fullWidth onClick={() => setOpen(open === "reject" ? null : "reject")}>
              <X className="h-4 w-4" /> Reject
            </Button>
            {open === "reject" && (
              <div className="space-y-2">
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder="Why is this being rejected? The researcher sees this."
                  className={cn(FIELD, "h-auto py-2")}
                />
                <Button
                  size="sm"
                  variant="danger"
                  fullWidth
                  // The service requires at least ten characters, so the button
                  // stays disabled rather than letting the request 422.
                  disabled={reason.trim().length < 10}
                  loading={triage.reject.isPending}
                  onClick={() => triage.reject.mutate({ id, reason: reason.trim() })}
                >
                  Confirm rejection
                </Button>
              </div>
            )}
          </div>
        )}

        {canResolve && (
          <Button
            size="sm"
            fullWidth
            loading={triage.resolve.isPending}
            onClick={() => triage.resolve.mutate({ id })}
          >
            <Check className="h-4 w-4" /> Mark resolved
          </Button>
        )}
      </CardBody>
    </Card>
  );
}

const FIELD =
  "h-10 w-full rounded-xl border border-line-strong bg-bg-elevated px-3 text-[13.5px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30";
