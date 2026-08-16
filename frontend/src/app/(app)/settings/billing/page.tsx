"use client";

import Link from "next/link";
import { CreditCard, Download, Wallet, ArrowUpRight, Check } from "lucide-react";

import { Card, CardBody, Skeleton } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PayoutStateBadge } from "@/components/bounty/status-badges";
import { useSubscription, usePaymentMethods, useInvoices, useMyPayouts } from "@/hooks/use-account";
import { formatMoney, formatDate, formatRelative } from "@/lib/format";
import type { PlanId } from "@/types/account";

const PLAN_LABEL: Record<PlanId, string> = { free: "Free", pro: "Pro", team: "Team" };

export default function SettingsBillingPage() {
  const { data: sub } = useSubscription();
  const { data: methods } = usePaymentMethods();
  const { data: invoices } = useInvoices();
  const { data: payouts, isLoading: payoutsLoading } = useMyPayouts();

  const totalEarned = (payouts ?? []).filter((p) => p.state === "paid").reduce((sum, p) => sum + p.amountCents, 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-[20px] font-bold">Billing &amp; payouts</h2>
        <p className="mt-1 text-[14px] text-text-dim">Your subscription, payment methods, and bounty earnings.</p>
      </div>

      {/* subscription summary */}
      <Card>
        <CardBody className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-brand-gradient-soft text-accent">
              <CreditCard className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-display text-[16px] font-bold">{sub ? PLAN_LABEL[sub.planId] : "—"} plan</span>
                {sub?.status === "active" && <Badge tone="success">Active</Badge>}
              </div>
              <div className="text-[13px] text-text-faint">
                {sub && sub.planId !== "free" && sub.currentPeriodEnd ? `Renews ${formatDate(sub.currentPeriodEnd)}` : "Manage your plan"}
              </div>
            </div>
          </div>
          <Link href="/billing"><Button variant="ghost" size="sm">Manage <ArrowUpRight className="h-4 w-4" /></Button></Link>
        </CardBody>
      </Card>

      {/* payouts */}
      <Card>
        <CardBody>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-display text-[16px] font-bold">
              <Wallet className="h-5 w-5 text-accent" /> Bounty payouts
            </h3>
            {totalEarned > 0 && (
              <div className="text-right">
                <div className="text-[11.5px] text-text-faint">Total earned</div>
                <div className="font-display text-[18px] font-extrabold text-gradient">{formatMoney(totalEarned, "USD")}</div>
              </div>
            )}
          </div>

          {payoutsLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : !payouts || payouts.length === 0 ? (
            <p className="text-[14px] text-text-dim">No payouts yet. Submit valid bug reports to earn bounties.</p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-line">
              {payouts.map((p) => (
                <div key={p.id} className="flex items-center justify-between border-b border-line px-4 py-3 last:border-0">
                  <div>
                    <div className="flex items-center gap-2">
                      <code className="font-mono text-[12.5px] font-semibold text-text-faint">{p.reportShortId}</code>
                      <span className="text-[13.5px] font-medium">{p.programName}</span>
                    </div>
                    <div className="text-[12px] text-text-faint">
                      {p.paidAt ? `Paid ${formatRelative(p.paidAt)}` : `Requested ${formatRelative(p.requestedAt)}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <PayoutStateBadge state={p.state} />
                    <span className="font-display text-[15px] font-bold text-success">{formatMoney(p.amountCents, p.currency)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* payment methods (compact) */}
      <Card>
        <CardBody>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-display text-[16px] font-bold">Payment methods</h3>
            <Button variant="ghost" size="sm">Add</Button>
          </div>
          {!methods || methods.length === 0 ? (
            <p className="text-[14px] text-text-dim">No payment methods on file.</p>
          ) : (
            <div className="space-y-2">
              {methods.map((m) => (
                <div key={m.id} className="flex items-center gap-3 rounded-xl border border-line p-3">
                  <CreditCard className="h-5 w-5 text-text-dim" />
                  <span className="text-[14px] font-medium capitalize">{m.brand} ···· {m.last4}</span>
                  {m.isDefault && <span className="ml-auto rounded bg-brand-gradient-soft px-1.5 py-0.5 text-[10.5px] font-semibold text-accent">Default</span>}
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* invoices (compact) */}
      <Card>
        <CardBody>
          <h3 className="mb-3 font-display text-[16px] font-bold">Recent invoices</h3>
          {!invoices || invoices.length === 0 ? (
            <p className="text-[14px] text-text-dim">No invoices yet.</p>
          ) : (
            <div className="space-y-1.5">
              {invoices.slice(0, 3).map((inv) => (
                <div key={inv.id} className="flex items-center justify-between rounded-lg px-1 py-2">
                  <div className="flex items-center gap-2.5">
                    <span className="grid h-7 w-7 place-items-center rounded-md bg-success/12"><Check className="h-3.5 w-3.5 text-success" strokeWidth={2.5} /></span>
                    <span className="font-mono text-[12.5px]">{inv.number}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[13.5px] font-semibold">{formatMoney(inv.amountCents, inv.currency)}</span>
                    {inv.pdfUrl && <a href={inv.pdfUrl} className="text-text-faint hover:text-text"><Download className="h-4 w-4" /></a>}
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
