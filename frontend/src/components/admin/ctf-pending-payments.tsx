"use client";

/**
 * The organiser's confirmation queue for bank transfers.
 *
 * With no gateway configured the platform hands a team the account details and
 * a reference, and then waits: the money lands in a bank, not in an API, and
 * nothing tells the platform it arrived. This is where someone reads the
 * statement and says so.
 *
 * The button calls the same service method a gateway webhook does, so there is
 * one implementation of "this team is in" however the money got there — and it
 * is idempotent, so pressing it twice cannot count the team twice or inflate
 * the event's participant total.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { BadgeCheck, Loader2, RefreshCw, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { ctfAdminApi } from "@/lib/ctf-admin-api";

type Pending = Awaited<ReturnType<typeof ctfAdminApi.listPendingTeams>>[number];

function money(cents: number, currency: string | null): string {
  // Amounts are stored in minor units across the board, so this divides once
  // and lets the locale decide how many decimals to show — PKR renders whole,
  // USD renders to two, without a currency table to keep in step.
  const code = (currency || "USD").toUpperCase();
  return `${code} ${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function waiting(since: string | null): string {
  if (!since) return "";
  const mins = Math.floor((Date.now() - new Date(since).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function CtfPendingPayments({ eventId }: { eventId: string }) {
  const [rows, setRows] = useState<Pending[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await ctfAdminApi.listPendingTeams(eventId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load pending payments");
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function confirm(row: Pending) {
    setConfirming(row.team_id);
    try {
      await ctfAdminApi.confirmTeamPayment(eventId, {
        team_id: row.team_id,
        provider_reference: row.provider_reference ?? undefined,
      });
      toast.success(`“${row.team_name || "Team"}” confirmed — they are in`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not confirm");
    } finally {
      setConfirming(null);
    }
  }

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[14px] font-semibold">
            <Wallet className="h-4 w-4" /> Waiting on payment
          </div>
          <Button variant="ghost" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>

        <p className="text-[12px] text-text-faint">
          Teams that were given the bank details and have not been confirmed. Match the
          reference against your statement, then confirm — the team is registered the
          moment you do, exactly as a gateway payment would register it.
        </p>

        {loading ? (
          <p className="flex items-center gap-2 text-[13px] text-text-dim">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : rows.length === 0 ? (
          <p className="text-[13px] text-text-dim">
            Nobody is waiting. Teams appear here once they start a bank transfer.
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li
                key={r.team_id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-line-strong bg-bg-elevated px-3.5 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold">
                    {r.team_name || r.team_id.slice(0, 8)}
                  </p>
                  <p className="mt-0.5 text-[12px] text-text-faint">
                    {/* The reference is the only thing tying a line on the
                        statement to a row here, so it is shown verbatim and in
                        a mono face — a transposed character is the whole cost
                        of getting this wrong. */}
                    <code className="font-mono">{r.provider_reference || "no reference"}</code>
                    {r.created_at && <> · {waiting(r.created_at)}</>}
                  </p>
                </div>
                <span className="shrink-0 text-[13px] font-semibold">
                  {money(r.amount_cents, r.currency)}
                </span>
                <Button
                  onClick={() => confirm(r)}
                  disabled={confirming === r.team_id}
                  className="shrink-0"
                >
                  {confirming === r.team_id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <BadgeCheck className="h-4 w-4" />
                  )}
                  Confirm
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
