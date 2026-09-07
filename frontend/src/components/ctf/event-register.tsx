"use client";

/**
 * Registration control for a CTF event.
 *
 * Registration is per player, not per team: several teammates each hold their
 * own row against the same team, which is why there is no unique constraint on
 * (event_id, team_id). The control used to read the other way — a team picker
 * sitting beside a button labelled "Register team" — which told the captain
 * they were entering everyone. They were not. They were entering themselves,
 * and their teammates were left with no signal that they still had to act.
 *
 * So there is one button now. Choosing a team is a step inside it rather than a
 * control of its own, and each team is shown with the slots it has already
 * taken, because "Alpha Squad 2/4" is the fact that decides whether entering
 * here is even possible — and, if the team is nearly full, whether a player
 * would rather enter under a different one.
 *
 * The entry fee is the one thing that is per team rather than per player. It is
 * paid once, by the captain, and a paid event therefore has a second step: the
 * team is registered first, then settled. The order matters — there is nothing
 * to pay for until the team has an entry — and it is why the button reads
 * "Continue" rather than "Register" when a fee applies.
 */

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Crown, Loader2, Users, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/identity";
import { cn } from "@/lib/cn";
import { ctfApi } from "@/lib/community-api";
import { useCtfRegister } from "@/hooks/use-community";
import { teamsApi, type Team } from "@/lib/teams-api";
import { useAuthStore } from "@/stores/auth-store";
import { TeamPaymentDialog, formatMoney } from "@/components/ctf/team-payment-dialog";

export function EventRegister({
  slug,
  registered,
  teamPlay,
  entryFeeCents = 0,
  currency = "USD",
}: {
  slug: string;
  registered: boolean;
  teamPlay: boolean;
  /** Minor units. Above zero turns registration into a two-step flow. */
  entryFeeCents?: number;
  currency?: string;
}) {
  const [open, setOpen] = useState(false);

  if (registered) {
    return (
      <span className="inline-block bg-success/12 px-4 py-2 text-[14px] font-semibold text-success">
        ✓ Registered
      </span>
    );
  }

  if (!teamPlay) return <SoloRegister slug={slug} />;

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        {entryFeeCents > 0 ? `Register · ${formatMoney(entryFeeCents, currency)}` : "Register"}
      </Button>
      {open && (
        <TeamPicker
          slug={slug}
          entryFeeCents={entryFeeCents}
          currency={currency}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function SoloRegister({ slug }: { slug: string }) {
  const reg = useCtfRegister(slug);
  return (
    <Button loading={reg.isPending} onClick={() => reg.mutate(undefined)}>
      Register
    </Button>
  );
}

function TeamPicker({
  slug,
  entryFeeCents,
  currency,
  onClose,
}: {
  slug: string;
  entryFeeCents: number;
  currency: string;
  onClose: () => void;
}) {
  const me = useAuthStore((s) => s.user);
  const reg = useCtfRegister(slug);
  const [picked, setPicked] = useState<string | null>(null);

  // For a paid event the fee comes first. A player cannot enter under a team
  // whose entry is unsettled — the API refuses it — so registering before
  // paying would just be an error message. The captain settles the entry, and
  // everyone registers after that, including the captain.
  const [paying, setPaying] = useState<{ id: string; name: string; captain: boolean } | null>(null);

  const gate = useMutation({
    mutationFn: async (teamId: string) => ctfApi.teamEntryStatus(slug, teamId),
  });

  const teams = useQuery({ queryKey: ["my-teams"], queryFn: () => teamsApi.listMine() });
  const slots = useQuery({ queryKey: ["ctf-team-slots", slug], queryFn: () => ctfApi.teamSlots(slug) });

  const max = slots.data?.maxTeamSize ?? null;
  const counts = slots.data?.counts ?? {};
  const loading = teams.isLoading || slots.isLoading;
  const mine = teams.data ?? [];

  function taken(team: Team) {
    return counts[team.id] ?? 0;
  }
  function full(team: Team) {
    return max != null && taken(team) >= max;
  }

  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Choose a team to enter with"
      onClick={onClose}
    >
      <div
        className="glass-strong edge-iridescent w-full max-w-[460px]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="font-display text-[16px] font-bold tracking-mega">Enter with a team</h2>
            <p className="mt-0.5 text-[12px] text-text-dim">
              You are entering yourself. Each teammate registers separately.
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

        <div className="max-h-[50vh] overflow-y-auto p-3">
          {loading && (
            <p className="flex items-center justify-center gap-2 py-10 text-[13px] text-text-faint">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking your teams…
            </p>
          )}

          {!loading && mine.length === 0 && (
            <div className="px-4 py-10 text-center">
              <Users className="mx-auto h-6 w-6 text-text-ghost" />
              <p className="mt-3 text-[13px] text-text-dim">You are not in a team yet.</p>
              <Link href="/teams" className="mt-1 inline-block text-[13px] font-semibold text-accent hover:underline">
                Find or create one →
              </Link>
            </div>
          )}

          {!loading &&
            mine.map((t) => {
              const isFull = full(t);
              const isCaptain = me?.id === t.owner_id;
              return (
                <button
                  key={t.id}
                  disabled={isFull}
                  onClick={() => setPicked(t.id)}
                  className={cn(
                    "flex w-full items-center gap-3 border px-4 py-3 text-left transition-colors",
                    "mb-2 last:mb-0",
                    isFull
                      ? "cursor-not-allowed border-line opacity-50"
                      : picked === t.id
                        ? "border-accent bg-surface-hover"
                        : "border-line hover:border-line-strong hover:bg-surface-hover",
                  )}
                >
                  <Avatar username={t.name} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[13.5px] text-text">{t.name}</span>
                      {isCaptain && <Crown className="h-3.5 w-3.5 shrink-0 text-warning" />}
                    </span>
                    <span className="text-[11.5px] text-text-faint">
                      {t.member_count} member{t.member_count === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span
                      className={cn(
                        "block font-mono text-[13px] tabular-nums",
                        isFull ? "text-warning" : "text-text",
                      )}
                    >
                      {taken(t)}
                      {max != null ? `/${max}` : ""}
                    </span>
                    <span className="block text-[10px] uppercase tracking-wide text-text-ghost">
                      {isFull ? "full" : "entered"}
                    </span>
                  </span>
                </button>
              );
            })}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-4">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={reg.isPending || gate.isPending}
            disabled={!picked}
            onClick={() => {
              if (!picked) return;
              const team = mine.find((t) => t.id === picked);

              if (entryFeeCents <= 0 || !team) {
                reg.mutate(picked, { onSuccess: onClose });
                return;
              }

              // Settled already — a teammate arriving after the captain paid,
              // or the captain coming back to take their own seat.
              gate.mutate(picked, {
                onSuccess: (status) => {
                  if (status?.settled) {
                    reg.mutate(picked, { onSuccess: onClose });
                    return;
                  }
                  setPaying({
                    id: team.id,
                    name: team.name,
                    captain: me?.id === team.owner_id,
                  });
                },
              });
            }}
          >
            {entryFeeCents > 0 ? "Continue" : "Register"}
          </Button>
        </footer>
      </div>

      {paying && (
        <TeamPaymentDialog
          slug={slug}
          teamId={paying.id}
          teamName={paying.name}
          amountCents={entryFeeCents}
          currency={currency}
          isCaptain={paying.captain}
          onClose={onClose}
        />
      )}
    </div>
  );
}
