"use client";

import Link from "next/link";
import { CreditCard, Download, Check, AlertCircle, Sparkles } from "lucide-react";

import { Card, CardBody, Skeleton } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSubscription, usePaymentMethods, useInvoices, useCancelSubscription } from "@/hooks/use-account";
import { formatMoney, formatDate } from "@/lib/format";
import type { PlanId } from "@/types/account";

const PLAN_LABEL: Record<PlanId, string> = { free: "Free", pro: "Pro", team: "Team" };

export default function BillingPage() {
  const { data: sub, isLoading } = useSubscription();
  const { data: methods } = usePaymentMethods();
  const { data: invoices } = useInvoices();
  const cancel = useCancelSubscription();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2.5 font-display text-[28px] font-extrabold tracking-[-0.5px]">
          <CreditCard className="h-6 w-6 text-text-faint" strokeWidth={1.6} /> Billing
        </h1>
        <p className="mt-1 text-[15px] text-text-dim">Manage your subscription, payment methods, and invoices.</p>
      </div>

      {/* current plan */}
      {isLoading || !sub ? (
        <Skeleton className="h-40 w-full rounded-2xl" />
      ) : (
        <Card className={sub.planId !== "free" ? "border-accent/40" : undefined}>
          <CardBody>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-[20px] font-bold">{PLAN_LABEL[sub.planId]} plan</h2>
                  {sub.status === "active" && <Badge tone="success">Active</Badge>}
                  {sub.status === "past_due" && <Badge tone="danger">Past due</Badge>}
                  {sub.status === "trialing" && <Badge tone="info">Trial</Badge>}
                  {sub.cancelAtPeriodEnd && <Badge tone="warning">Cancels at period end</Badge>}
                </div>
                {sub.planId !== "free" ? (
                  <p className="mt-1.5 text-[14px] text-text-dim">
                    Billed {sub.period}
                    {sub.seats > 1 && ` · ${sub.seats} seats`}
                    {sub.currentPeriodEnd && ` · renews ${formatDate(sub.currentPeriodEnd)}`}
                  </p>
                ) : (
                  <p className="mt-1.5 text-[14px] text-text-dim">You&apos;re on the free plan. Upgrade for all active machines and unlimited labs.</p>
                )}
              </div>
              <div className="flex gap-2.5">
                {sub.planId === "free" ? (
                  <Link href="/billing/checkout"><Button><Sparkles className="h-[18px] w-[18px]" /> Upgrade</Button></Link>
                ) : (
                  <>
                    <Link href="/billing/checkout"><Button variant="ghost">Change plan</Button></Link>
                    {!sub.cancelAtPeriodEnd && (
                      <Button variant="ghost" loading={cancel.isPending} onClick={() => cancel.mutate()}>Cancel</Button>
                    )}
                  </>
                )}
              </div>
            </div>

            {sub.status === "past_due" && (
              <div className="mt-4 flex items-center gap-2.5 rounded-xl border border-danger/25 bg-danger/8 p-3 text-[13.5px] text-text-dim">
                <AlertCircle className="h-5 w-5 shrink-0 text-danger" />
                Your last payment failed. Update your payment method to keep Pro access.
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* payment methods */}
      <Card>
        <CardBody>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-display text-[17px] font-bold">Payment methods</h3>
            <Button variant="ghost" size="sm">Add method</Button>
          </div>
          {!methods || methods.length === 0 ? (
            <p className="text-[14px] text-text-dim">No payment methods on file.</p>
          ) : (
            <div className="space-y-2.5">
              {methods.map((m) => (
                <div key={m.id} className="flex items-center justify-between rounded-xl border border-line p-3.5">
                  <div className="flex items-center gap-3">
                    <div className="grid h-9 w-12 place-items-center rounded-md bg-surface-hover">
                      <CreditCard className="h-5 w-5 text-text-dim" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 text-[14px] font-semibold capitalize">
                        {m.brand} ···· {m.last4}
                        {m.isDefault && <span className="rounded bg-brand-gradient-soft px-1.5 py-0.5 text-[10.5px] font-semibold text-accent">Default</span>}
                      </div>
                      <div className="text-[12.5px] text-text-faint">Expires {String(m.expMonth).padStart(2, "0")}/{m.expYear}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* invoices */}
      <Card>
        <CardBody>
          <h3 className="mb-4 font-display text-[17px] font-bold">Invoices</h3>
          {!invoices || invoices.length === 0 ? (
            <p className="text-[14px] text-text-dim">No invoices yet.</p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-line">
              {invoices.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between border-b border-line px-4 py-3 last:border-0">
                  <div className="flex items-center gap-3">
                    <span className="grid h-8 w-8 place-items-center rounded-lg bg-success/12">
                      <Check className="h-4 w-4 text-success" strokeWidth={2.5} />
                    </span>
                    <div>
                      <div className="font-mono text-[13px] font-medium">{inv.number}</div>
                      <div className="text-[12px] text-text-faint">{formatDate(inv.createdAt)}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="font-display text-[14px] font-bold">{formatMoney(inv.amountCents, inv.currency)}</span>
                    {inv.pdfUrl && (
                      <a href={inv.pdfUrl} className="grid h-8 w-8 place-items-center rounded-lg border border-line-strong text-text-dim hover:text-text" aria-label="Download invoice">
                        <Download className="h-4 w-4" />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
