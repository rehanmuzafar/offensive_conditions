import { cn } from "@/lib/cn";
import type { Severity } from "@/types";
import type { ReportState, Payout } from "@/types/bounty";

/* -------------------------------------------------------------------------- */
/* Severity                                                                   */
/* -------------------------------------------------------------------------- */
const SEV: Record<Severity, { label: string; cls: string }> = {
  critical: { label: "Critical", cls: "text-danger bg-danger/12 border-danger/25" },
  high: { label: "High", cls: "text-warning bg-warning/12 border-warning/25" },
  medium: { label: "Medium", cls: "text-info bg-info/12 border-info/25" },
  low: { label: "Low", cls: "text-success bg-success/12 border-success/25" },
  informational: { label: "Info", cls: "text-text-dim bg-surface-hover border-line" },
};

export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  const s = SEV[severity];
  return (
    <span className={cn("inline-flex items-center border px-2.5 py-0.5 text-[12px] font-semibold", s.cls, className)}>
      {s.label}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Report state                                                               */
/* -------------------------------------------------------------------------- */
const REPORT_STATE: Record<ReportState, { label: string; cls: string }> = {
  submitted: { label: "Submitted", cls: "text-info bg-info/12" },
  triaging: { label: "Triaging", cls: "text-warning bg-warning/12" },
  accepted: { label: "Accepted", cls: "text-success bg-success/12" },
  rejected: { label: "Rejected", cls: "text-danger bg-danger/12" },
  duplicate: { label: "Duplicate", cls: "text-text-dim bg-surface-hover" },
  informational: { label: "Informational", cls: "text-text-dim bg-surface-hover" },
  resolved: { label: "Resolved", cls: "text-accent bg-brand-gradient-soft" },
  paid: { label: "Paid", cls: "text-success bg-success/12" },
  closed: { label: "Closed", cls: "text-text-faint bg-surface-hover" },
};

export function ReportStateBadge({ state, className }: { state: ReportState; className?: string }) {
  const s = REPORT_STATE[state];
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-semibold", s.cls, className)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {s.label}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Payout state                                                               */
/* -------------------------------------------------------------------------- */
const PAYOUT_STATE: Record<Payout["state"], { label: string; cls: string }> = {
  requested: { label: "Requested", cls: "text-info bg-info/12" },
  processing: { label: "Processing", cls: "text-warning bg-warning/12" },
  paid: { label: "Paid", cls: "text-success bg-success/12" },
  failed: { label: "Failed", cls: "text-danger bg-danger/12" },
  canceled: { label: "Canceled", cls: "text-text-faint bg-surface-hover" },
};

export function PayoutStateBadge({ state, className }: { state: Payout["state"]; className?: string }) {
  const s = PAYOUT_STATE[state];
  return (
    <span className={cn("inline-flex items-center px-2.5 py-0.5 text-[12px] font-semibold", s.cls, className)}>
      {s.label}
    </span>
  );
}
