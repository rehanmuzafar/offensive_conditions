"use client";

/**
 * Paying a team's entry fee.
 *
 * The fee belongs to the team and is paid once, by the captain. That is not a
 * rule this dialog invents — the API refuses anyone else — but it is the reason
 * the screen has two shapes. A captain gets a payment form. A teammate gets an
 * explanation and no buttons, which is more useful than a control that fails.
 *
 * Method and provider are different questions. The payer picks card, JazzCash
 * or EasyPaisa; which gateway settles it is configuration they never see. While
 * no gateway is configured the service answers with bank details instead of a
 * redirect, and that is shown as-is rather than hidden behind a spinner — an
 * organiser confirming a transfer is a real way to be paid, not a failure.
 */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Building2, CreditCard, Loader2, Smartphone, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { ctfApi } from "@/lib/community-api";
import type { PaymentMethod, TeamPaymentIntent } from "@/types/ctf";

/**
 * Minor units to something a person reads.
 *
 * Intl handles the currency's own scale, which is the part worth not doing by
 * hand: dividing by 100 is right for PKR and USD and wrong for JPY.
 */
export function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100);
  } catch {
    // An unknown currency code should not take the page down with it.
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

const METHODS: { id: PaymentMethod; label: string; hint: string; icon: typeof CreditCard }[] = [
  { id: "card", label: "Card", hint: "Credit or debit", icon: CreditCard },
  { id: "jazzcash", label: "JazzCash", hint: "Mobile wallet", icon: Smartphone },
  { id: "easypaisa", label: "EasyPaisa", hint: "Mobile wallet", icon: Smartphone },
];

export function TeamPaymentDialog({
  slug,
  teamId,
  teamName,
  amountCents,
  currency,
  isCaptain,
  onClose,
}: {
  slug: string;
  teamId: string;
  teamName: string;
  amountCents: number;
  currency: string;
  isCaptain: boolean;
  onClose: () => void;
}) {
  const [method, setMethod] = useState<PaymentMethod>("card");
  const [intent, setIntent] = useState<TeamPaymentIntent | null>(null);

  const pay = useMutation({
    mutationFn: () => ctfApi.startTeamPayment(slug, teamId, method),
    onSuccess: (data) => {
      const url = data.instructions?.redirect_url;
      // A gateway hands back somewhere to go. Bank details do not, and the
      // panel below shows them instead.
      if (typeof url === "string" && url) {
        window.location.href = url;
        return;
      }
      setIntent(data);
    },
  });

  const amount = formatMoney(amountCents, currency);

  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Pay the team entry fee"
      onClick={onClose}
    >
      <div
        className="glass-strong edge-iridescent w-full max-w-[460px]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="font-display text-[16px] font-bold tracking-mega">Entry fee</h2>
            <p className="mt-0.5 text-[12px] text-text-dim">
              {teamName} · <span className="font-mono tabular-nums text-text">{amount}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 shrink-0 place-items-center border border-line text-text-faint transition-colors hover:border-line-strong hover:text-text"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {!isCaptain ? (
          <div className="px-5 py-8 text-center">
            <p className="text-[13.5px] text-text">Your captain pays for the team.</p>
            <p className="mt-1.5 text-[12.5px] text-text-dim">
              One entry covers everyone, so nobody else is charged — and the roster can still
              change afterwards.
            </p>
          </div>
        ) : intent ? (
          <BankInstructions intent={intent} />
        ) : (
          <div className="p-5">
            <p className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-text-faint">
              Pay with
            </p>
            <div className="grid gap-2">
              {METHODS.map((m) => {
                const Icon = m.icon;
                const active = method === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => setMethod(m.id)}
                    aria-pressed={active}
                    className={cn(
                      "flex items-center gap-3 border px-4 py-3 text-left transition-colors",
                      active
                        ? "border-accent bg-surface-hover"
                        : "border-line hover:border-line-strong hover:bg-surface-hover",
                    )}
                  >
                    <Icon
                      className={cn("h-4 w-4 shrink-0", active ? "text-accent" : "text-text-faint")}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] text-text">{m.label}</span>
                      <span className="block text-[11.5px] text-text-faint">{m.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            {pay.isError && (
              <p role="alert" className="mt-3 text-[12.5px] text-danger">
                {pay.error instanceof Error ? pay.error.message : "Could not start the payment."}
              </p>
            )}

            <p className="mt-4 text-[11.5px] leading-relaxed text-text-ghost">
              One payment covers the whole team. You can change who plays afterwards without
              paying again.
            </p>
          </div>
        )}

        {isCaptain && !intent && (
          <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-4">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button loading={pay.isPending} onClick={() => pay.mutate()}>
              Pay {amount}
            </Button>
          </footer>
        )}
      </div>
    </div>
  );
}

/**
 * What to do when the answer is a bank transfer rather than a redirect.
 *
 * The reference is the whole point of this panel: without it in the transfer
 * description nobody can match the money to a team, and the entry sits pending
 * while an organiser guesses.
 */
function BankInstructions({ intent }: { intent: TeamPaymentIntent }) {
  const i = intent.instructions as Record<string, string | undefined>;
  const rows = [
    ["Account name", i.account_name],
    ["Account number", i.account_number],
    ["Bank", i.bank_name],
    ["IBAN", i.iban],
  ].filter(([, v]) => Boolean(v)) as [string, string][];

  if (i.method !== "bank_transfer") {
    return (
      <div className="px-5 py-8 text-center">
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-text-faint" />
        <p className="mt-3 text-[13px] text-text-dim">
          {i.note || "Waiting for the payment provider."}
        </p>
      </div>
    );
  }

  return (
    <div className="p-5">
      <div className="mb-4 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-text-faint">
        <Building2 className="h-3.5 w-3.5" /> Bank transfer
      </div>

      <dl className="grid gap-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-4 border-b border-line pb-2">
            <dt className="text-[12px] text-text-faint">{label}</dt>
            <dd className="text-right font-mono text-[12.5px] text-text">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 border border-accent/40 bg-accent/8 px-4 py-3">
        <p className="text-[11.5px] uppercase tracking-wide text-text-faint">Reference</p>
        <p className="mt-1 break-all font-mono text-[14px] font-semibold text-accent">
          {intent.reference}
        </p>
        <p className="mt-2 text-[11.5px] leading-relaxed text-text-dim">
          Put this in the payment description. It is how your transfer is matched to your team —
          without it the entry stays pending.
        </p>
      </div>
    </div>
  );
}
