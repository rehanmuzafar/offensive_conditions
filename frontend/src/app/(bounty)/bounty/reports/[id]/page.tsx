"use client";

import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Send } from "lucide-react";

import { Card, CardBody, Skeleton } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/identity";
import { Markdown } from "@/components/ui/markdown";
import { SeverityBadge, ReportStateBadge } from "@/components/bounty/status-badges";
import {
  useReport,
  useReportComment,
  useReportComments,
  useReportTimeline,
} from "@/hooks/use-account";
import { formatMoney, formatRelative, formatDate } from "@/lib/format";
import type { ReportStateTransition } from "@/types/bounty";

export default function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: report, isLoading } = useReport(id);
  // Both are their own endpoints — see the note on useReportComments.
  const { data: comments = [], isLoading: commentsLoading } = useReportComments(id);
  const { data: timeline = [] } = useReportTimeline(id);

  if (isLoading || !report) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/bounty/reports" className="inline-flex items-center gap-1.5 text-[14px] text-text-dim hover:text-text">
        <ArrowLeft className="h-4 w-4" /> My reports
      </Link>

      {/* header */}
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <code className="font-mono text-[13px] font-semibold text-text-faint">{report.shortId}</code>
          <SeverityBadge severity={report.severity} />
          <ReportStateBadge state={report.state} />
          {report.cvssScore != null && (
            <span className="rounded-md bg-surface-hover px-2 py-0.5 text-[12px] font-semibold text-text-dim">CVSS {report.cvssScore}</span>
          )}
        </div>
        <h1 className="mt-2.5 font-display text-[26px] font-extrabold leading-tight tracking-[-0.5px]">{report.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-text-faint">
          <Link href={`/bounty/${report.programSlug}`} className="font-medium text-accent hover:underline">{report.programName}</Link>
          <span>·</span>
          <code className="font-mono text-[12.5px]">{report.assetIdentifier}</code>
          <span>·</span>
          <span>Submitted {formatDate(report.createdAt)}</span>
        </div>
      </div>

      {/* bounty banner if paid */}
      {report.bountyCents > 0 && (
        <Card className="border-success/30">
          <CardBody className="flex items-center justify-between">
            <div>
              <div className="text-[13px] text-text-faint">Bounty awarded</div>
              <div className="font-display text-[24px] font-extrabold text-success">{formatMoney(report.bountyCents, report.bountyCurrency ?? "USD")}</div>
            </div>
            <Link href="/settings/billing"><Button variant="ghost" size="sm">View payouts</Button></Link>
          </CardBody>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* main */}
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardBody>
              <Section title="Description"><Markdown>{report.descriptionMd}</Markdown></Section>
              <Section title="Steps to reproduce">
                <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl border border-line bg-bg-elevated p-4 font-mono text-[13px] leading-relaxed text-text-dim">{report.reproductionSteps}</pre>
              </Section>
              <Section title="Impact"><p className="text-[15px] leading-relaxed text-text-dim">{report.impact}</p></Section>
              {report.cvssVector && (
                <Section title="CVSS vector">
                  <code className="block rounded-lg bg-surface-hover px-3 py-2 font-mono text-[12.5px] text-text-dim">{report.cvssVector}</code>
                </Section>
              )}
              {report.vrtCategory && (
                <Section title="VRT category">
                  <code className="text-[13px] text-text-dim">{report.vrtCategory}</code>
                </Section>
              )}
            </CardBody>
          </Card>

          {/* comments */}
          <Card>
            <CardBody>
              <h3 className="mb-4 font-display text-[17px] font-bold">Activity</h3>
              <div className="space-y-4">
                {comments.length === 0 && !commentsLoading && (
                  <p className="text-[13.5px] text-text-dim">
                    No replies yet. The triage team will comment here.
                  </p>
                )}
                {comments.map((c) => (
                  <div key={c.id} className="flex gap-3">
                    <Avatar username={c.authorName} size="sm" className="mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-display text-[14px] font-semibold">{c.authorName}</span>
                        {c.authorRole === "triager" && (
                          <span className="rounded bg-accent/12 px-1.5 py-0.5 text-[10.5px] font-semibold text-accent">Triager</span>
                        )}
                        {c.visibility === "internal" && <span className="rounded bg-warning/12 px-1.5 py-0.5 text-[10.5px] font-semibold text-warning">Internal</span>}
                        <span className="ml-auto text-[12px] text-text-faint">{formatRelative(c.createdAt)}</span>
                      </div>
                      <div className="mt-1 rounded-xl border border-line bg-bg-elevated p-3">
                        <Markdown>{c.bodyMd}</Markdown>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <CommentBox id={id} />
            </CardBody>
          </Card>
        </div>

        {/* timeline */}
        <div>
          <Card>
            <CardBody>
              <h3 className="mb-4 font-display text-[16px] font-bold">Timeline</h3>
              <Timeline transitions={timeline} />
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6 last:mb-0">
      <h3 className="mb-2 font-display text-[15px] font-bold text-text">{title}</h3>
      {children}
    </div>
  );
}

function Timeline({ transitions }: { transitions: ReportStateTransition[] }) {
  return (
    <ol className="relative space-y-5 border-l border-line pl-5">
      {transitions.map((t) => (
        <li key={t.id} className="relative">
          <span className="absolute -left-[26px] top-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-brand-gradient ring-4 ring-bg" />
          <div className="flex items-center gap-2">
            <ReportStateBadge state={t.toState} />
          </div>
          <div className="mt-1.5 text-[12.5px] text-text-faint">
            by <span className="font-medium text-text-dim">{t.actorName}</span> · {formatRelative(t.at)}
          </div>
          {t.reason && <p className="mt-1 text-[13px] text-text-dim">{t.reason}</p>}
        </li>
      ))}
    </ol>
  );
}

function CommentBox({ id }: { id: string }) {
  const comment = useReportComment(id);
  const [body, setBody] = useState("");

  function submit() {
    if (!body.trim()) return;
    comment.mutate({ bodyMd: body }, { onSuccess: () => setBody("") });
  }

  return (
    <div className="mt-5 border-t border-line pt-5">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder="Add a comment or provide more information…"
        className="w-full resize-y rounded-xl border border-line-strong bg-bg-elevated px-3.5 py-3 text-[14.5px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
      />
      <div className="mt-2.5 flex justify-end">
        <Button loading={comment.isPending} disabled={!body.trim()} onClick={submit}>
          <Send className="h-4 w-4" /> Comment
        </Button>
      </div>
    </div>
  );
}
