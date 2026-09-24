"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Eye, Pencil, ShieldCheck } from "lucide-react";

import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/input";
import { Markdown } from "@/components/ui/markdown";
import { SeverityBadge } from "@/components/bounty/status-badges";
import { useProgram, useSubmitReport } from "@/hooks/use-account";
import { cn } from "@/lib/cn";
import type { Severity } from "@/types";

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "informational"];

export default function SubmitReportPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const router = useRouter();
  const { data: program } = useProgram(slug);
  const submit = useSubmitReport(slug);

  const [title, setTitle] = useState("");
  const [asset, setAsset] = useState("");
  const [severity, setSeverity] = useState<Severity>("medium");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState("");
  const [impact, setImpact] = useState("");
  const [cvss, setCvss] = useState("");
  const [preview, setPreview] = useState(false);

  // Minimums match what bounty-svc enforces. The description gate was 30 here
  // against 50 there, so a 30-to-49 character write-up passed the button and
  // came back a 422 the researcher had no way to interpret.
  const canSubmit =
    title.trim().length >= 5 &&
    asset.trim().length > 0 &&
    description.trim().length >= 50 &&
    steps.trim().length >= 10 &&
    impact.trim().length >= 5;

  function onSubmit() {
    if (!canSubmit) return;
    submit.mutate(
      { title, assetIdentifier: asset, severity, descriptionMd: description, reproductionSteps: steps, impact, cvssVector: cvss || undefined },
      {
        onSuccess: (report) => router.push(`/bounty/reports/${report.id}`),
        // Deliberately stays on the page. It used to navigate to the report
        // list on failure, throwing away everything the researcher had typed
        // for what is usually a fixable validation error.
      },
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href={`/bounty/${slug}`} className="inline-flex items-center gap-1.5 text-[14px] text-text-dim hover:text-text">
        <ArrowLeft className="h-4 w-4" /> {program?.name ?? "Program"}
      </Link>

      <div>
        <h1 className="font-display text-[26px] font-extrabold tracking-[-0.5px]">Submit a report</h1>
        <p className="mt-1 text-[14.5px] text-text-dim">
          Reporting to <b className="text-text">{program?.name ?? slug}</b>. Be thorough — clear reports get triaged faster.
        </p>
      </div>

      {program?.safeHarbor && (
        <div className="flex items-center gap-3 rounded-xl border border-success/25 bg-success/8 p-4">
          <ShieldCheck className="h-5 w-5 shrink-0 text-success" />
          <p className="text-[13.5px] text-text-dim">This program offers <b className="text-text">safe harbor</b> for good-faith research conducted within scope.</p>
        </div>
      )}

      <Card>
        <CardBody className="space-y-1">
          <FormField label="Title" htmlFor="title" required help="A concise summary of the vulnerability.">
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Stored XSS in product review form" />
          </FormField>

          <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
            <FormField label="Affected asset" htmlFor="asset" required>
              <Input id="asset" value={asset} onChange={(e) => setAsset(e.target.value)} placeholder="shop.acme.example" />
            </FormField>
            <FormField label="CVSS vector (optional)" htmlFor="cvss">
              <Input id="cvss" value={cvss} onChange={(e) => setCvss(e.target.value)} placeholder="CVSS:3.1/AV:N/..." />
            </FormField>
          </div>

          <FormField label="Severity" htmlFor="severity" required>
            <div className="flex flex-wrap gap-2">
              {SEVERITIES.map((s) => (
                <button
                  key={s}
                  onClick={() => setSeverity(s)}
                  className={cn("border px-3 py-1.5 transition-colors", severity === s ? "border-accent bg-brand-gradient-soft" : "border-line-strong hover:bg-surface-hover")}
                >
                  <SeverityBadge severity={s} className="!border-0 !bg-transparent !px-0" />
                </button>
              ))}
            </div>
          </FormField>

          {/* description with preview */}
          <div className="mb-4">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[13.5px] font-semibold text-text">Description <span className="text-danger">*</span></span>
              <div className="flex rounded-lg border border-line-strong p-0.5">
                <button onClick={() => setPreview(false)} className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12.5px] font-medium", !preview ? "bg-surface-hover text-text" : "text-text-faint")}><Pencil className="h-3.5 w-3.5" /> Write</button>
                <button onClick={() => setPreview(true)} className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12.5px] font-medium", preview ? "bg-surface-hover text-text" : "text-text-faint")}><Eye className="h-3.5 w-3.5" /> Preview</button>
              </div>
            </div>
            {preview ? (
              <div className="min-h-[140px] rounded-xl border border-line bg-bg-elevated p-4">
                {description.trim() ? <Markdown>{description}</Markdown> : <span className="text-[14px] text-text-faint">Nothing to preview yet.</span>}
              </div>
            ) : (
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={6} placeholder="Describe the vulnerability. Markdown supported. At least 50 characters." className="w-full resize-y rounded-xl border border-line-strong bg-bg-elevated px-3.5 py-3 text-[14.5px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30" />
            )}
          </div>

          <FormField label="Steps to reproduce" htmlFor="steps" required>
            <textarea id="steps" value={steps} onChange={(e) => setSteps(e.target.value)} rows={5} placeholder={"1. Navigate to…\n2. Submit…\n3. Observe…"} className="w-full resize-y rounded-xl border border-line-strong bg-bg-elevated px-3.5 py-3 font-mono text-[13.5px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30" />
          </FormField>

          <FormField label="Impact" htmlFor="impact" required help="What can an attacker achieve?">
            <textarea id="impact" value={impact} onChange={(e) => setImpact(e.target.value)} rows={3} placeholder="Describe the security impact." className="w-full resize-y rounded-xl border border-line-strong bg-bg-elevated px-3.5 py-3 text-[14.5px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30" />
          </FormField>

          <div className="flex items-center justify-end gap-3 pt-2">
            <Link href={`/bounty/${slug}`}><Button variant="ghost">Cancel</Button></Link>
            <Button loading={submit.isPending} disabled={!canSubmit} onClick={onSubmit}>Submit report</Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
